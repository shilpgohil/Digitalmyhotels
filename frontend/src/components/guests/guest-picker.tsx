"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Search, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api/use-api";
import { ApiError } from "@/lib/api/client";
import type { GuestAutofill, GuestOut, GuestSearchResult } from "@/types/stay";
import { sanitizeGuestPhone, sanitizeAadhaarOcr } from "@/lib/input-discipline";

interface GuestPickerProps {
  onSelected: (guest: { id: string; full_name: string; phone: string }) => void;
  selected?: { id: string; full_name: string } | null;
  /**
   * When provided, the "Create new guest" button delegates to the parent
   * (receiving the phone that was searched) instead of opening the built-in
   * mini creation form. Lets pages render their own rich new-guest form.
   */
  onCreateNew?: (searchedPhone: string) => void;
}

/**
 * Guest reuse workflow: search by phone or last-4 ID → explicit autofill → pick.
 * Falls back to inline creation for new guests. Never shows booking history.
 */
export function GuestPicker({ onSelected, selected, onCreateNew }: GuestPickerProps) {
  const t = useTranslations("guestPicker");
  const tc = useTranslations("common");
  const api = useApi();
  const [phone, setPhone] = useState("");
  const [last4, setLast4] = useState("");
  const [results, setResults] = useState<GuestSearchResult[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Tracks the phone value at the time search was run so it can seed new-guest form.
  const [searchedPhone, setSearchedPhone] = useState("");
  // Whether the most recent search was by ID last-4 (drives duplicate warning).
  const [wasIdSearch, setWasIdSearch] = useState(false);

  const search = useMutation({
    mutationFn: async () => {
      const params = phone
        ? `phone=${encodeURIComponent(phone)}`
        : `id_last4=${encodeURIComponent(last4)}`;
      return api<{ items: GuestSearchResult[] }>(`/api/v1/guests/search?${params}`);
    },
    onSuccess: (data) => {
      setResults(data.items);
      setWasIdSearch(!phone && !!last4);
      // Capture the phone at search time so it correctly pre-fills the new guest form.
      setSearchedPhone(phone);
      // Client 9-08 item 4: when nothing matches, open the full Create Guest
      // flow IMMEDIATELY — the extra "Create new guest" click was reported as
      // friction at the desk. The button stays as a fallback for re-opening.
      if (data.items.length === 0) {
        if (onCreateNew) {
          onCreateNew(phone);
        } else {
          setShowCreate(true);
        }
      } else {
        setShowCreate(false);
      }
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  const autofill = useMutation({
    mutationFn: (guestId: string) =>
      api<GuestAutofill>(`/api/v1/guests/${guestId}/autofill`, { method: "POST" }),
    onSuccess: (guest) => {
      onSelected({ id: guest.id, full_name: guest.full_name, phone: guest.phone });
      toast.success(t("guestSelected"));
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  // Cross-hotel import (plan §1.7): copies the guest (base data + ID photos)
  // into THIS hotel — explicit, phone-proofed, audited — then selects the
  // fresh LOCAL record like any other pick.
  const importGuest = useMutation({
    mutationFn: (sourceGuestId: string) =>
      api<GuestOut>("/api/v1/guests/import", {
        method: "POST",
        body: { source_guest_id: sourceGuestId, phone: searchedPhone },
      }),
    onSuccess: (guest) => {
      toast.success(t("guestImported"));
      onSelected({
        id: guest.id,
        full_name: guest.full_name,
        phone: guest.normalized_phone,
      });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  const create = useMutation({
    mutationFn: (form: FormData) =>
      api<GuestOut>("/api/v1/guests", {
        method: "POST",
        body: {
          full_name: String(form.get("full_name")).trim(),
          phone: String(form.get("phone")).trim(),
          id_proof_type: String(form.get("id_proof_type") || "").trim() || null,
          // Strip internal spaces from Aadhaar (OCR/paste: "1234 5678 9012" → "123456789012").
          id_number: (() => {
            const raw = String(form.get("id_number") || "").trim();
            if (!raw) return null;
            const idType = String(form.get("id_proof_type") || "").trim();
            return idType === "Aadhar Card" ? sanitizeAadhaarOcr(raw) : raw;
          })(),
        },
      }),
    onSuccess: (guest) => {
      onSelected({
        id: guest.id,
        full_name: guest.full_name,
        phone: guest.normalized_phone,
      });
      toast.success(t("guestCreated"));
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success-bg px-3 py-2 text-sm">
        <Check className="size-4 text-success" aria-hidden />
        <span className="font-medium">{selected.full_name}</span>
        <button
          type="button"
          className="ml-auto text-xs underline"
          onClick={() => {
            setResults(null);
            setShowCreate(false);
            onSelected({ id: "", full_name: "", phone: "" });
          }}
          // Client 9-08 item 8: "Change" is clearer than "Edit" — it signals
          // "search for a different guest" without implying data will be lost.
        >
          {tc("change")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input
          placeholder={t("searchByPhone")}
          value={phone}
          maxLength={15}
          onChange={(e) => {
            setPhone(sanitizeGuestPhone(e.target.value));
            setLast4("");
          }}
          inputMode="tel"
          aria-label={t("searchByPhone")}
        />
        <Input
          placeholder={t("searchByLast4")}
          value={last4}
          maxLength={4}
          className="sm:w-36"
          onChange={(e) => {
            setLast4(e.target.value.replace(/\D/g, ""));
            setPhone("");
          }}
          aria-label={t("searchByLast4")}
        />
        <Button
          type="button"
          /* Client spec 09/2026: NavyBlue solid, 42px height — matches the input fields */
          className="h-[42px] bg-navy-900 text-white hover:bg-navy-800 px-4"
          onClick={() => search.mutate()}
          disabled={search.isPending || (phone.length < 3 && last4.length !== 4)}
        >
          <Search className="size-4" aria-hidden />
          {t("searchAction")}
        </Button>
      </div>

      {results && results.length > 0 && (() => {
        // Detect if multiple results share the same id_last4 — same person,
        // different phones. Mirror the co-guest duplicate-ID warning.
        const idLast4Counts: Record<string, number> = {};
        for (const g of results) {
          if (g.id_last4) idLast4Counts[g.id_last4] = (idLast4Counts[g.id_last4] ?? 0) + 1;
        }
        const hasDuplicates = wasIdSearch && Object.values(idLast4Counts).some((c) => c > 1);
        return (
          <div className="space-y-2">
            {hasDuplicates && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{t("duplicateIdWarning", { count: results.length })}</span>
              </div>
            )}
            <ul className="divide-y rounded-md border">
              {results.map((hit) => {
                const isDupInResults = wasIdSearch && hit.id_last4 && (idLast4Counts[hit.id_last4] ?? 0) > 1;
                return (
                  /* Clicking the entire row selects the guest — the separate "Auto Fill"
                     button was removed at client request ("Again remove Auto-Fill"). The
                     row is keyboard-focusable so accessibility is preserved. */
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-60"
                      disabled={autofill.isPending || importGuest.isPending}
                      onClick={() =>
                        hit.cross_hotel ? importGuest.mutate(hit.id) : autofill.mutate(hit.id)
                      }
                    >
                      {/* Guest info */}
                      <span className="font-medium flex-1 min-w-0 truncate">{hit.full_name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{hit.phone_masked}</span>
                      {hit.id_last4 && (
                        <span className="text-xs text-muted-foreground shrink-0">ID ••{hit.id_last4}</span>
                      )}
                      {/* Duplicate Aadhaar — same person, different phones */}
                      {isDupInResults && (
                        <span className="rounded-full bg-warning-bg px-2 py-0.5 text-micro font-semibold text-warning shrink-0">
                          {t("sameIdDiffPhone")}
                        </span>
                      )}
                      {/* Guest found at ANOTHER hotel (plan §1.7) */}
                      {hit.cross_hotel && (
                        <span className="rounded-full bg-info-bg px-2 py-0.5 text-micro font-semibold text-info shrink-0">
                          {t("otherHotelBadge")}
                        </span>
                      )}
                      {/* Clear "Select" button so staff knows tapping this row selects the guest */}
                      <span className="ml-auto shrink-0 inline-flex h-7 items-center rounded-md bg-navy-900 px-2.5 text-xs font-semibold text-white">
                        {hit.cross_hotel ? t("importAction") : t("selectGuest")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasDuplicates && (
              <p className="text-micro text-muted-foreground px-1">{t("duplicateIdHint")}</p>
            )}
          </div>
        );
      })()}

      {results && results.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
          {!showCreate && (
            <Button
              type="button"
              size="sm"
              className="bg-gold-500 text-navy-900 hover:bg-gold-600"
              onClick={() =>
                onCreateNew ? onCreateNew(searchedPhone) : setShowCreate(true)
              }
            >
              <UserPlus className="size-4" aria-hidden />
              {t("createNewGuest")}
            </Button>
          )}
        </div>
      )}

      {showCreate && (
        <div className="space-y-3 border-t pt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            <UserPlus className="size-3.5" aria-hidden />
            {t("newGuest")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="gp-name">{t("fullName")}</Label>
              <Input id="gp-name" name="gp_full_name" data-guest-field="full_name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-phone">{t("phoneNumber")}</Label>
              {/* key forces re-mount when searchedPhone changes, keeping value in sync */}
              <Input
                key={`gp-phone-${searchedPhone}`}
                id="gp-phone"
                name="gp_phone"
                data-guest-field="phone"
                defaultValue={searchedPhone}
                inputMode="tel"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-idtype">{t("idProofType")}</Label>
              <select
                id="gp-idtype"
                data-guest-field="id_proof_type"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {/* Canonical display-label values — same set the check-in
                    forms store, so guest records stay consistent. */}
                <option value="">—</option>
                <option value="Aadhar Card">Aadhar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Passport">Passport</option>
                <option value="Driving License">Driving License</option>
                <option value="Voter ID">Voter ID</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-idnum">{t("idNumber")}</Label>
              {/* maxLength 20 covers all ID types (Aadhaar 12, PAN 10, DL 16, etc.) */}
              <Input id="gp-idnum" data-guest-field="id_number" maxLength={20} />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={create.isPending}
            onClick={(e) => {
              const container = (e.currentTarget as HTMLElement).closest("div.space-y-3");
              if (!container) return;
              const form = new FormData();
              container
                .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-guest-field]")
                .forEach((el) => form.set(el.dataset.guestField as string, el.value));
              if (!String(form.get("full_name") || "").trim() || !String(form.get("phone") || "").trim()) {
                toast.error(tc("requiredField"));
                return;
              }
              create.mutate(form);
            }}
          >
            {create.isPending ? tc("saving") : tc("save")}
          </Button>
        </div>
      )}
    </div>
  );
}
