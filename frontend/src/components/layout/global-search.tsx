"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  BedDouble,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { formatStatus } from "@/lib/format-status";
import { fmtApiDateTime } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type { BookingOut, GuestOut } from "@/types/stay";

function useDebounced(value: string, delay = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch() {
  const t = useTranslations("search");
  const tc = useTranslations("common");
  const api = useApi();
  const router = useRouter();
  const { activeHotelId, can } = useAuth();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const debounced = useDebounced(term);
  const boxRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const enabled = !!activeHotelId && debounced.trim().length >= 2;

  const bookings = useQuery({
    queryKey: ["gsearch-bookings", activeHotelId, debounced],
    queryFn: () =>
      api<ListOut<BookingOut>>(
        `/api/v1/bookings?limit=5&q=${encodeURIComponent(debounced)}`,
      ),
    enabled: enabled && can(PERMISSIONS.bookingsView),
  });

  const guests = useQuery({
    queryKey: ["gsearch-guests", activeHotelId, debounced],
    queryFn: () =>
      api<ListOut<GuestOut>>(`/api/v1/guests?limit=5&q=${encodeURIComponent(debounced)}`),
    enabled: enabled && can(PERMISSIONS.guestsView),
  });

  // Close desktop dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Lock body scroll and autofocus when mobile search opens
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      const timer = setTimeout(() => {
        mobileInputRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = "";
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [mobileOpen]);

  // Handle Escape key to close search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setMobileOpen(false);
    setTerm("");
    router.push(path);
  };

  const closeMobile = () => {
    setMobileOpen(false);
    setOpen(false);
    setTerm("");
  };

  const handleBookingClick = (b: BookingOut) => {
    const dest =
      b.status === "checked_in"
        ? `/current-guests?q=${encodeURIComponent(b.booking_number)}`
        : b.status === "checked_out"
          ? `/completed-bookings?q=${encodeURIComponent(b.booking_number)}`
          : b.status === "cancelled" || b.status === "no_show"
            ? `/completed-bookings?q=${encodeURIComponent(b.booking_number)}&status=cancelled`
          : `/advance-bookings?q=${encodeURIComponent(b.booking_number)}`;
    go(dest);
  };

  const handleGuestClick = async (g: GuestOut) => {
    // 1. Check if guest is currently checked in (in-house stay)
    const inHouseBooking = bookings.data?.items.find(
      (b) =>
        (b.primary_guest_id === g.id ||
          b.primary_guest_name?.toLowerCase() === g.full_name.toLowerCase()) &&
        b.status === "checked_in",
    );
    if (inHouseBooking) {
      go(`/current-guests?q=${encodeURIComponent(g.full_name)}`);
      return;
    }

    // 2. Check if guest has an upcoming advance booking
    const upcomingBooking = bookings.data?.items.find(
      (b) =>
        (b.primary_guest_id === g.id ||
          b.primary_guest_name?.toLowerCase() === g.full_name.toLowerCase()) &&
        (b.status === "confirmed" || b.status === "pending"),
    );
    if (upcomingBooking) {
      go(`/advance-bookings?q=${encodeURIComponent(g.full_name)}`);
      return;
    }

    // 3. Fast verification: check if guest has an active in-house stay
    try {
      const inHouseCheck = await api<ListOut<{ booking_id: string }>>(
        `/api/v1/current-guests?limit=1&q=${encodeURIComponent(g.full_name)}`,
      );
      if (inHouseCheck.items && inHouseCheck.items.length > 0) {
        go(`/current-guests?q=${encodeURIComponent(g.full_name)}`);
        return;
      }

      const advanceCheck = await api<ListOut<{ id: string }>>(
        `/api/v1/bookings?status=pending,confirmed&limit=1&q=${encodeURIComponent(g.full_name)}`,
      );
      if (advanceCheck.items && advanceCheck.items.length > 0) {
        go(`/advance-bookings?q=${encodeURIComponent(g.full_name)}`);
        return;
      }
    } catch {
      // fallback
    }

    // 4. Past / checked-out guest: route directly to Completed Bookings
    go(`/completed-bookings?q=${encodeURIComponent(g.full_name)}`);
  };

  const hasResults =
    (bookings.data?.items.length ?? 0) > 0 || (guests.data?.items.length ?? 0) > 0;
  const isLoading = bookings.isLoading || guests.isLoading;

  if (!can(PERMISSIONS.bookingsView) && !can(PERMISSIONS.guestsView)) return null;

  // Reusable iOS-styled search results list
  const renderResultsList = () => (
    <>
      {isLoading && (
        <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4.5 animate-spin text-gold-500" />
          <span className="text-[13px] font-medium">{t("searching")}</span>
        </div>
      )}

      {!hasResults && !isLoading && (
        <div className="rounded-2xl border border-border/50 bg-card p-6 text-center shadow-2xs space-y-1">
          <Search className="size-5 text-muted-foreground/40 mx-auto mb-1" aria-hidden />
          <p className="text-sm font-semibold text-foreground">{t("noResults")}</p>
          <p className="text-xs text-muted-foreground">{t("noResultsHint")}</p>
        </div>
      )}

      {(bookings.data?.items.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <div className="px-1 flex items-center justify-between text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>{t("bookings")}</span>
            <span className="text-micro font-normal text-muted-foreground">
              {bookings.data?.items.length}
            </span>
          </div>
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-2xs divide-y divide-border/30">
            {bookings.data?.items.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleBookingClick(b)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
              >
                <div className="size-8.5 rounded-xl bg-gold-500/10 text-gold-600 dark:text-gold-400 flex items-center justify-center shrink-0">
                  <CalendarRange className="size-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13.5px] text-foreground tracking-tight group-hover:text-gold-600 transition-colors">
                      {b.booking_number}
                    </span>
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded-md font-medium bg-muted text-muted-foreground">
                      {formatStatus(b.status)}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground truncate">
                    {b.primary_guest_name ?? "—"} · {fmtApiDateTime(b.check_in_date, b.check_in_time)}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      {(guests.data?.items.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <div className="px-1 flex items-center justify-between text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>{t("guests")}</span>
            <span className="text-micro font-normal text-muted-foreground">
              {guests.data?.items.length}
            </span>
          </div>
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-2xs divide-y divide-border/30">
            {guests.data?.items.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => handleGuestClick(g)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
              >
                <div className="size-8.5 rounded-xl bg-navy-500/10 text-navy-600 dark:text-navy-300 flex items-center justify-center shrink-0">
                  <UserRound className="size-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[13.5px] text-foreground tracking-tight truncate group-hover:text-gold-600 transition-colors">
                    {g.full_name}
                  </p>
                  <p className="text-[12px] text-muted-foreground tabular-nums">
                    {g.normalized_phone ? `+91 ····${g.normalized_phone.slice(-4)}` : "—"}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* ── 1. Desktop Search Input Bar (Visible only on md: screens and wider) ── */}
      <div className="relative hidden w-full max-w-sm md:block" ref={boxRef}>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          aria-label={t("placeholder")}
          placeholder={t("placeholder")}
          className="h-9 w-full rounded-full border border-border/60 bg-muted/50 pr-8 pl-9 text-xs outline-none focus:border-gold-500/50 focus:bg-background transition-all shadow-2xs"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {term && (
          <button
            type="button"
            onClick={() => setTerm("")}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 size-4 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 text-muted-foreground flex items-center justify-center transition-colors cursor-pointer"
            aria-label={tc("close")}
          >
            <X className="size-2.5" aria-hidden />
          </button>
        )}
        {open && enabled && (
          <div className="absolute top-11 right-0 left-0 z-50 min-w-[380px] rounded-2xl border border-border/60 bg-popover/98 p-2.5 shadow-2xl backdrop-blur-xl space-y-2.5">
            {renderResultsList()}
          </div>
        )}
      </div>

      {/* ── 2. Mobile Search Trigger Button (Minimalist Apple iOS pill icon) ── */}
      <button
        type="button"
        onClick={() => {
          setMobileOpen(true);
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground active:scale-95 transition-all md:hidden cursor-pointer"
        aria-label={t("placeholder")}
        title={t("placeholder")}
      >
        <Search className="size-4" aria-hidden />
      </button>

      {/* ── 3. Mobile Apple Spotlight / iOS-style Search View ── */}
      {mobileOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-slate-50/98 dark:bg-slate-950/98 text-foreground animate-in fade-in duration-150">
            {/* Top Search App-Bar with iOS pill search input & Cancel button */}
            <div className="flex h-14 items-center gap-2.5 px-3.5 border-b border-border/40 bg-background/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
              <div className="flex-1 h-9.5 rounded-xl bg-muted/70 dark:bg-muted/40 px-3 flex items-center gap-2 border border-border/30 focus-within:border-gold-500/50 focus-within:bg-background transition-all">
                <Search className="size-4 text-muted-foreground shrink-0" aria-hidden />
                <input
                  ref={mobileInputRef}
                  type="search"
                  aria-label={t("placeholder")}
                  placeholder={t("placeholder")}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                  }}
                  className="w-full bg-transparent text-[14px] outline-none text-foreground placeholder:text-muted-foreground/60"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => {
                      setTerm("");
                      mobileInputRef.current?.focus();
                    }}
                    className="size-4.5 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 text-muted-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    aria-label={tc("close")}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeMobile}
                className="text-[14px] font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 active:scale-95 transition-all px-1.5 py-1 cursor-pointer shrink-0"
              >
                {tc("cancel")}
              </button>
            </div>

            {/* Scrollable Body: Inset Grouped layout (Apple Spotlight style) */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
              {term.trim().length < 2 ? (
                /* Quick Shortcuts when nothing is typed yet */
                <div className="space-y-1.5">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("quickShortcuts")}
                  </p>
                  <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-2xs divide-y divide-border/30">
                    <button
                      type="button"
                      onClick={() => go("/current-guests")}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
                    >
                      <div className="size-8.5 rounded-xl bg-gold-500/10 text-gold-600 dark:text-gold-400 flex items-center justify-center shrink-0">
                        <BedDouble className="size-4.5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-foreground group-hover:text-gold-600 transition-colors">
                          {t("inHouse")}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground truncate">
                          {t("inHouseDesc")}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/advance-bookings")}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
                    >
                      <div className="size-8.5 rounded-xl bg-navy-500/10 text-navy-600 dark:text-navy-300 flex items-center justify-center shrink-0">
                        <CalendarRange className="size-4.5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-foreground group-hover:text-gold-600 transition-colors">
                          {t("advance")}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground truncate">
                          {t("advanceDesc")}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/checkin")}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
                    >
                      <div className="size-8.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <KeyRound className="size-4.5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-foreground group-hover:text-gold-600 transition-colors">
                          {t("newCheckin")}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground truncate">
                          {t("newCheckinDesc")}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/completed-bookings")}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
                    >
                      <div className="size-8.5 rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="size-4.5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-foreground group-hover:text-gold-600 transition-colors">
                          {t("completed")}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground truncate">
                          {t("completedDesc")}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden />
                    </button>
                  </div>
                  <p className="text-center text-[12px] text-muted-foreground/60 pt-3">
                    {t("searchHint")}
                  </p>
                </div>
              ) : (
                /* Search Results */
                renderResultsList()
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
