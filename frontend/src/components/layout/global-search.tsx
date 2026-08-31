"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Search, CalendarRange, UserRound } from "lucide-react";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate } from "@/lib/formatting";
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
    <div className="relative hidden w-full max-w-xs md:block" ref={boxRef}>
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
        <div className="absolute top-11 right-0 left-0 z-50 rounded-lg border bg-card shadow-lg">
          {!hasResults && !bookings.isLoading && !guests.isLoading && (
            <p className="px-3 py-4 text-sm text-muted-foreground">{t("noResults")}</p>
          )}
          {(bookings.data?.items.length ?? 0) > 0 && (
            <div className="py-1">
              <p className="px-3 py-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                {t("bookings")}
              </p>
              {bookings.data?.items.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => go("/bookings")}
                >
                  <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{b.booking_number}</span>
                  <span className="truncate text-muted-foreground">
                    {b.primary_guest_name ?? ""} · {fmtApiDate(b.check_in_date)}
                  </span>
                </button>
              ))}
            </div>
          )}
          {(guests.data?.items.length ?? 0) > 0 && (
            <div className="border-t py-1">
              <p className="px-3 py-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                {t("guests")}
              </p>
              {guests.data?.items.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => go("/current-guests")}
                >
                  <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{g.full_name}</span>
                  <span className="text-muted-foreground">
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
