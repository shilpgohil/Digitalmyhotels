"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, CircleHelp, LogOut, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import type { HotelOut } from "@/types/hotel";
import { PartnerBrand, PartnerNav } from "@/components/layout/partner-sidebar";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { GlobalSearch } from "@/components/layout/global-search";
import { useProductTour } from "@/components/tour/product-tour";

function initials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Compact hotel select shown only when the user belongs to MORE than one
 * hotel. Switching updates the auth context (drives the X-Hotel-Id header
 * app-wide) and clears the react-query cache, since the context itself does
 * not invalidate queries on switch.
 */
function HotelSwitcher({ className }: { readonly className?: string }) {
  const t = useTranslations("nav");
  const { memberships, activeHotelId, setActiveHotelId } = useAuth();
  const queryClient = useQueryClient();

  // Memberships only carry hotel_id — fetch each hotel's name via the
  // per-request X-Hotel-Id override. Only enabled for multi-hotel users.
  const hotelQueries = useQueries({
    queries: memberships.map((m) => ({
      queryKey: ["hotel-switcher-name", m.hotel_id],
      queryFn: () =>
        apiFetch<HotelOut>("/api/v1/hotels/me", { hotelId: m.hotel_id }),
      staleTime: 300_000,
      enabled: memberships.length > 1,
    })),
  });

  if (memberships.length <= 1) return null;

  const nameOf = (hotelId: string): string => {
    const idx = memberships.findIndex((m) => m.hotel_id === hotelId);
    return hotelQueries[idx]?.data?.name ?? `${t("hotel")} ${idx + 1}`;
  };

  const switchTo = (hotelId: string) => {
    if (hotelId === activeHotelId) return;
    setActiveHotelId(hotelId);
    // The context only persists the id — drop all cached data so every
    // screen refetches under the new X-Hotel-Id.
    queryClient.clear();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm",
          className,
        )}
        aria-label={t("switchHotel")}
        title={t("switchHotel")}
      >
        <Building2 className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="max-w-36 truncate">
          {activeHotelId ? nameOf(activeHotelId) : t("switchHotel")}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t("switchHotel")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem key={m.hotel_id} onClick={() => switchTo(m.hotel_id)}>
            <span className="flex-1 truncate">{nameOf(m.hotel_id)}</span>
            {m.hotel_id === activeHotelId && (
              <Check className="size-4 shrink-0" aria-hidden />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hamburger + slide-in drawer with the same nav as the desktop sidebar. */
function MobileNavDrawer() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground lg:hidden"
        aria-label={t("openMenu")}
        title={t("openMenu")}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground"
          aria-label={t("openMenu")}
        >
          <SheetTitle className="sr-only">{t("openMenu")}</SheetTitle>
          <PartnerBrand />
          <div className="px-3 pb-1">
            <HotelSwitcher className="w-full border-sidebar-border" />
          </div>
          <PartnerNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function PartnerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTranslations("auth");
  const tt = useTranslations("tour");
  const { user, logout } = useAuth();
  const router = useRouter();
  // Use startTourInPlace — the user is already on a partner page,
  // so the tour runs contextually without navigating away.
  const { startTourInPlace } = useProductTour();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <header className="flex items-center justify-between gap-4 border-b bg-card px-4 py-4 lg:px-6">
      <MobileNavDrawer />
      <div className="min-w-0">
        {subtitle && (
          <p className="text-[10px] font-semibold tracking-widest text-gold-600 uppercase">
            {subtitle}
          </p>
        )}
        <h1 className="truncate font-display text-2xl text-foreground">{title}</h1>
      </div>
      <GlobalSearch />
      <div className="flex shrink-0 items-center gap-3">
        <HotelSwitcher className="hidden lg:flex" />
        <button
          type="button"
          onClick={startTourInPlace}
          className="flex size-9 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground"
          aria-label={tt("helpButton")}
          title={tt("helpButton")}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
        <span data-tour="bell">
          <NotificationsBell />
        </span>
        <span data-tour="locale">
          <LocaleSwitcher />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            aria-label="User menu"
          >
            {initials(user?.full_name)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              <span className="block text-sm">{user?.full_name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user?.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} variant="destructive">
              <LogOut className="size-4" aria-hidden />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
