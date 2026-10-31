"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronRight,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

function getBookingDestination(b: BookingOut): string {
  const encoded = encodeURIComponent(b.booking_number);
  if (b.status === "checked_in") {
    return `/current-guests?q=${encoded}`;
  }
  if (b.status === "checked_out") {
    return `/completed-bookings?q=${encoded}`;
  }
  if (b.status === "cancelled" || b.status === "no_show") {
    return `/completed-bookings?q=${encoded}&status=cancelled`;
  }
  return `/advance-bookings?q=${encoded}`;
}

export interface GlobalSearchProps {
  /**
   * "desktop" renders only the centered desktop search bar.
   * "mobile" renders the mobile trigger button and mobile full-screen search portal.
   * "both" (default) renders both desktop and mobile triggers.
   */
  readonly variant?: "desktop" | "mobile" | "both";
}

export function GlobalSearch({ variant = "both" }: GlobalSearchProps) {
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
  const isNavigatingRef = useRef(false);

  // Gesture tracking to distinguish mobile scrolling from deliberate taps
  const touchStartYRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);

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
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setOpen(false);
    setMobileOpen(false);
    setTerm("");
    router.push(path);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  const handleOpenMobile = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setMobileOpen(true);
    // CRITICAL: Synchronous focus during user touch/click triggers virtual keyboard instantly on iOS/Android
    mobileInputRef.current?.focus();
  };

  const closeMobile = () => {
    mobileInputRef.current?.blur();
    setMobileOpen(false);
    setOpen(false);
    setTerm("");
  };

  const handleBookingClick = (b: BookingOut) => {
    go(getBookingDestination(b));
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

  // Touch gesture handlers: prevents dragging/scrolling from triggering accidental taps
  const handleTouchStart = (e: React.TouchEvent) => {
    isScrollingRef.current = false;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null || touchStartXRef.current === null) return;
    const dy = Math.abs(e.touches[0].clientY - touchStartYRef.current);
    const dx = Math.abs(e.touches[0].clientX - touchStartXRef.current);
    if (dy > 8 || dx > 8) {
      isScrollingRef.current = true;
    }
  };

  const handleTouchEndBooking = (b: BookingOut) => {
    if (isScrollingRef.current) return;
    handleBookingClick(b);
  };

  const handleTouchEndGuest = (g: GuestOut) => {
    if (isScrollingRef.current) return;
    void handleGuestClick(g);
  };

  const hasResults =
    (bookings.data?.items.length ?? 0) > 0 || (guests.data?.items.length ?? 0) > 0;
  const isLoading = bookings.isLoading || guests.isLoading;

  if (!can(PERMISSIONS.bookingsView) && !can(PERMISSIONS.guestsView)) return null;

  // Reusable search results list
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
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={() => handleTouchEndBooking(b)}
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
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={() => handleTouchEndGuest(g)}
                onClick={() => {
                  void handleGuestClick(g);
                }}
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

  const showDesktop = variant === "desktop" || variant === "both";
  const showMobile = variant === "mobile" || variant === "both";

  return (
    <>
      {/* ── 1. Desktop Search Input Bar (Top Center on Desktop/Web) ── */}
      {showDesktop && (
        <div className="relative hidden w-full max-w-md md:block" ref={boxRef}>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            className="global-search-input h-9 w-full rounded-full border border-border/60 bg-muted/60 pr-8 pl-9 text-xs outline-none focus:border-gold-500/50 focus:ring-2 focus:ring-gold-500/20 transition-all shadow-2xs"
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
      )}

      {/* ── 2. Mobile Search Trigger Button (Collapsed State in Header) ── */}
      {showMobile && (
        <button
          type="button"
          onClick={handleOpenMobile}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground active:scale-95 transition-all md:hidden cursor-pointer"
          aria-label={t("placeholder")}
          title={t("placeholder")}
        >
          <Search className="size-4" aria-hidden />
        </button>
      )}

      {/* ── 3. Mobile Full-Screen Overlay Portal (No Overlapping White Rectangles) ── */}
      {showMobile &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={cn(
              "fixed inset-0 z-50 md:hidden flex flex-col transition-all duration-200",
              mobileOpen
                ? "opacity-100 pointer-events-auto visible"
                : "opacity-0 pointer-events-none invisible",
            )}
          >
            {/* Top Bar: Solid, opaque background pinned to top, completely covering header */}
            <div className="h-14 w-full bg-background border-b border-border/60 px-3 flex items-center gap-2 shrink-0 shadow-xs">
              <div className="relative flex-1 flex items-center">
                <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground z-10 shrink-0" aria-hidden />
                <input
                  ref={mobileInputRef}
                  type="search"
                  aria-label={t("placeholder")}
                  placeholder={t("placeholder")}
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="global-search-input w-full h-9 rounded-full border border-input/80 bg-muted pl-9 pr-8 text-sm outline-none text-foreground placeholder:text-muted-foreground/60 focus:border-gold-500/60 focus:ring-2 focus:ring-gold-500/20 transition-all shadow-2xs"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => {
                      setTerm("");
                      mobileInputRef.current?.focus();
                    }}
                    className="absolute right-2.5 size-4.5 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 text-muted-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0 z-10"
                    aria-label={tc("close")}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeMobile}
                className="text-sm font-semibold text-gold-600 dark:text-gold-400 hover:text-gold-700 active:scale-95 transition-all px-1.5 py-1 cursor-pointer shrink-0"
              >
                {tc("cancel")}
              </button>
            </div>

            {/* Backdrop: covers remaining screen below top bar */}
            <button
              type="button"
              aria-label={tc("close")}
              tabIndex={-1}
              className="absolute inset-0 top-14 w-full h-[calc(100%-56px)] bg-black/30 backdrop-blur-[2px] border-none p-0 cursor-default outline-none"
              onClick={closeMobile}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeMobile();
              }}
            />

            {/* Floating Results Card: sits underneath top bar with zero overlap */}
            {enabled && (
              <div className="relative z-10 mx-3 mt-2 max-h-[calc(100vh-80px)] overflow-y-auto rounded-2xl border border-border/80 bg-popover shadow-2xl p-2.5 space-y-2 pointer-events-auto">
                {renderResultsList()}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
