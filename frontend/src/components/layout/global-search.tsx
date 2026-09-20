"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Search, CalendarRange, UserRound } from "lucide-react";
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
  const api = useApi();
  const router = useRouter();
  const { activeHotelId, can } = useAuth();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term);
  const boxRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setTerm("");
    router.push(path);
  };

  const hasResults =
    (bookings.data?.items.length ?? 0) > 0 || (guests.data?.items.length ?? 0) > 0;

  if (!can(PERMISSIONS.bookingsView) && !can(PERMISSIONS.guestsView)) return null;

  return (
    // max-w-sm (~384 px) is ~30% wider than max-w-xs (~320 px) — client request.
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
        // Dropdown inherits the wider container; min-w-[360px] prevents it from
        // shrinking on narrow viewports (client 09/2026: "increase width 30%").
        <div className="absolute top-11 right-0 left-0 z-50 min-w-[360px] rounded-lg border bg-card shadow-lg">
          {!hasResults && !bookings.isLoading && !guests.isLoading && (
            <p className="px-3 py-4 text-sm text-muted-foreground">{t("noResults")}</p>
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
                  className="flex w-full items-center gap-2 overflow-hidden px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    // Route by booking status so the result is actually visible
                    // (audit finding HIGH #7: all statuses were sent to
                    // advance-bookings which only shows pending/confirmed).
                    const dest =
                      b.status === "checked_in"
                        ? `/current-guests`
                        : b.status === "checked_out"
                          ? `/completed-bookings?q=${encodeURIComponent(b.booking_number)}`
                          : b.status === "cancelled" || b.status === "no_show"
                            ? `/completed-bookings?q=${encodeURIComponent(b.booking_number)}&status=cancelled`
                          : `/advance-bookings?q=${encodeURIComponent(b.booking_number)}`;
                    go(dest);
                  }}
                >
                  <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 font-medium">{b.booking_number}</span>
                  {/* Keep booking info on ONE line — truncate guest name if needed */}
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
                  className="flex w-full items-center gap-2 overflow-hidden px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => go("/current-guests")}
                >
                  <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{g.full_name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    ····{g.normalized_phone.slice(-4)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
