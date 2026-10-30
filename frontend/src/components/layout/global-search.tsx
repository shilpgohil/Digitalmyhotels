"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarRange,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDateTime } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type { BookingOut, GuestOut } from "@/types/stay";

function useDebounced(value: string, delay = 300): string {
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
      // Small timeout ensures the DOM node is attached before focusing
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

  if (!can(PERMISSIONS.bookingsView) && !can(PERMISSIONS.guestsView)) return null;

  // Reusable search results list
  const renderResults = () => (
    <>
      {!hasResults && !bookings.isLoading && !guests.isLoading && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
      )}
      {(bookings.isLoading || guests.isLoading) && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold-500" />
          <span>Searching…</span>
        </div>
      )}
      {(bookings.data?.items.length ?? 0) > 0 && (
        <div className="py-1">
          <p className="px-3 py-1 text-micro font-semibold tracking-widest text-muted-foreground uppercase">
            {t("bookings")}
          </p>
          {bookings.data?.items.map((b) => (
            <button
              key={b.id}
              type="button"
              className="flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left text-sm hover:bg-muted transition-colors cursor-pointer"
              onClick={() => handleBookingClick(b)}
            >
              <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-medium text-foreground">{b.booking_number}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {b.primary_guest_name ?? ""} · {fmtApiDateTime(b.check_in_date, b.check_in_time)}
              </span>
            </button>
          ))}
        </div>
      )}
      {(guests.data?.items.length ?? 0) > 0 && (
        <div className="border-t py-1">
          <p className="px-3 py-1 text-micro font-semibold tracking-widest text-muted-foreground uppercase">
            {t("guests")}
          </p>
          {guests.data?.items.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left text-sm hover:bg-muted transition-colors cursor-pointer"
              onClick={() => handleGuestClick(g)}
            >
              <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{g.full_name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                ····{g.normalized_phone.slice(-4)}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* ── 1. Desktop Search Input Bar (Visible only on md: screens and wider) ── */}
      <div className="relative hidden w-full max-w-sm md:block" ref={boxRef}>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          aria-label={t("placeholder")}
          placeholder={t("placeholder")}
          className="h-9 w-full rounded-full border bg-muted/50 pr-3 pl-8 text-sm outline-none focus:border-ring focus:bg-background"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {open && enabled && (
          <div className="absolute top-11 right-0 left-0 z-50 min-w-[360px] rounded-lg border bg-card shadow-lg">
            {renderResults()}
          </div>
        )}
      </div>

      {/* ── 2. Mobile Search Trigger Button (Visible only on mobile screens < md) ── */}
      <button
        type="button"
        onClick={() => {
          setMobileOpen(true);
          setOpen(true);
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground transition-colors md:hidden"
        aria-label={t("placeholder")}
        title={t("placeholder")}
      >
        <Search className="size-4" aria-hidden />
      </button>

      {/* ── 3. Mobile Full-Width Search Overlay (Option 1 Two-State App-Bar) ── */}
      {mobileOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col md:hidden">
            {/* Top search app-bar: sits directly over the sticky header with full 100% width */}
            <div className="flex h-[61px] items-center gap-2 border-b bg-background/98 glass-nav px-3 shadow-xs">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setOpen(false);
                  setTerm("");
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground transition-colors"
                aria-label={tc("back")}
                title={tc("back")}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  ref={mobileInputRef}
                  type="search"
                  aria-label={t("placeholder")}
                  placeholder={t("placeholder")}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    setOpen(true);
                  }}
                  className="h-9 w-full rounded-full border bg-muted/50 pr-8 pl-9 text-sm outline-none focus:border-ring focus:bg-background"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => {
                      setTerm("");
                      mobileInputRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={tc("close")}
                    title={tc("close")}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {/* Backdrop overlay + Scrollable Results dropdown directly beneath */}
            <div
              className="flex-1 overflow-y-auto bg-navy-950/40 backdrop-blur-xs"
              onClick={() => {
                setMobileOpen(false);
                setOpen(false);
              }}
            >
              <div
                className="max-h-[calc(100vh-80px)] overflow-y-auto border-b bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {term.trim().length < 2 ? (
                  <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground">
                    <Search className="mb-2 size-8 text-muted-foreground/30" aria-hidden />
                    <p className="text-sm font-medium">{t("searchHint")}</p>
                  </div>
                ) : (
                  renderResults()
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
