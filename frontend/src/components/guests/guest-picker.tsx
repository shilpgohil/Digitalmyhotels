"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api/use-api";
import { ApiError } from "@/lib/api/client";
import type { GuestAutofill, GuestOut, GuestSearchResult } from "@/types/stay";

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

  const search = useMutation({
    mutationFn: async () => {
      const params = phone
        ? `phone=${encodeURIComponent(phone)}`
        : `id_last4=${encodeURIComponent(last4)}`;
      return api<{ items: GuestSearchResult[] }>(`/api/v1/guests/search?${params}`);
    },
    onSuccess: (data) => {
      setResults(data.items);
      // Client-requested flow: no auto-expand — show a "Create new guest"
      // button on empty results and open the form only when clicked.
      setShowCreate(false);
      // Capture the phone at search time so it correctly pre-fills the new guest form.
      setSearchedPhone(phone);
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

  const create = useMutation({
    mutationFn: (form: FormData) =>
      api<GuestOut>("/api/v1/guests", {
        method: "POST",
        body: {
          full_name: String(form.get("full_name")).trim(),
          phone: String(form.get("phone")).trim(),
          id_proof_type: String(form.get("id_proof_type") || "").trim() || null,
          id_number: String(form.get("id_number") || "").trim() || null,
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
        >
          {tc("edit")}
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
          onChange={(e) => {
            setPhone(e.target.value.replace(/\D/g, ""));
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
          variant="outline"
          onClick={() => search.mutate()}
          disabled={search.isPending || (phone.length < 3 && last4.length !== 4)}
        >
          <Search className="size-4" aria-hidden />
          {t("searchAction")}
        </Button>
      </div>

      {results && results.length > 0 && (
        <ul className="divide-y rounded-md border">
          {results.map((hit) => (
            <li key={hit.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium">{hit.full_name}</span>
              <span className="text-muted-foreground">{hit.phone_masked}</span>
              {hit.id_last4 && (
                <span className="text-xs text-muted-foreground">ID ••{hit.id_last4}</span>
              )}
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={autofill.isPending}
                onClick={() => autofill.mutate(hit.id)}
              >
                {t("autofill")}
              </Button>
            </li>
          ))}
        </ul>
      )}

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
                <option value="">—</option>
                <option value="aadhaar">Aadhaar</option>
                <option value="passport">Passport</option>
                <option value="driving_license">Driving License</option>
                <option value="voter_id">Voter ID</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-idnum">{t("idNumber")}</Label>
              <Input id="gp-idnum" data-guest-field="id_number" />
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
