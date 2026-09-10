"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  PlusCircle,
  Hotel,
  CheckCircle,
  Clock,
  CreditCard,
  KeyRound,
  UserPlus,
  Users,
  XCircle,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";

/** Feature flag key shared with /admin/settings (client 9-08 item 36). */
const ALL_CUSTOMERS_FLAG = "admin.allCustomersEnabled";

const NAV_ITEMS = [
  { href: "/admin", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/admin/add-hotel", labelKey: "addNewHotel", icon: PlusCircle },
  { href: "/admin/hotels?filter=all", labelKey: "totalHotelsNav", icon: Hotel },
  { href: "/admin/hotels", labelKey: "activeHotelsNav", icon: CheckCircle },
  { href: "/admin/expired", labelKey: "recentlyExpiredNav", icon: Clock },
  { href: "/admin/registrations", labelKey: "recentRegistrationsNav", icon: UserPlus },
  { href: "/admin/expired?filter=all", labelKey: "expiredHotelsNav", icon: XCircle },
  { href: "/admin/password-requests", labelKey: "passwordRequestsNav", icon: KeyRound },
] as const;

function hrefIsActive(pathname: string, filter: string | null, href: string): boolean {
  const [path, qs] = href.split("?");
  const hrefFilter = qs ? new URLSearchParams(qs).get("filter") : null;

  if (path === "/admin") return pathname === "/admin";
  if (pathname !== path) return false;
  if (path === "/admin/hotels" || path === "/admin/expired") {
    if (hrefFilter === "all") return filter === "all";
    return filter !== "all";
  }
  return true;
}

function AdminSidebarInner({ onNavigate }: { readonly onNavigate?: () => void }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { logout } = useAuth();
  const filter = searchParams.get("filter");
  const plansActive = pathname.startsWith("/admin/plans");
  const settingsActive = pathname.startsWith("/admin/settings");
  const customersActive = pathname.startsWith("/admin/customers");

  // All Customers menu appears only when enabled in Settings (item 36).
  const [customersEnabled, setCustomersEnabled] = useState(false);
  useEffect(() => {
    const read = () =>
      setCustomersEnabled(window.localStorage.getItem(ALL_CUSTOMERS_FLAG) === "1");
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  return (
    <aside className="flex w-60 flex-col bg-white border-r border-border lg:h-full">
      {/* DMH horizontal logo — replaces generic "HotelAdmin" brand mark */}
      <div className="flex items-center justify-start px-5 py-4 border-b border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dmh-logo-horizontal.png"
          alt="DigitalMyHotels"
          height={36}
          className="h-9 w-auto select-none object-contain"
          draggable={false}
        />
      </div>

      {/* overflow-y-auto only; NO flex-1 — prevents white-space gap on mobile.
          On desktop (lg:h-full on aside) the spacer div pushes footer down. */}
      <nav className="overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = hrefIsActive(pathname, filter, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href + item.labelKey}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-gold-500 text-navy-900"
                      : "text-foreground hover:bg-gold-50 hover:text-gold-700",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop-only spacer: pushes footer to bottom on full-height sidebar.
          Hidden on mobile where the Sheet is h-auto (content-height). */}
      <div className="hidden lg:flex lg:flex-1" aria-hidden />

      <div className="border-t border-border px-3 py-4 space-y-0.5">
        {customersEnabled && (
          <Link
            href="/admin/customers"
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              customersActive
                ? "bg-gold-500 text-navy-900"
                : "text-foreground hover:bg-gold-50 hover:text-gold-700",
            )}
          >
            <Users className="size-4 shrink-0" aria-hidden />
            {t("allCustomersSection")}
          </Link>
        )}
        <Link
          href="/admin/plans"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            plansActive
              ? "bg-gold-500 text-navy-900"
              : "text-foreground hover:bg-gold-50 hover:text-gold-700",
          )}
        >
          <CreditCard className="size-4 shrink-0" aria-hidden />
          {t("plans")}
        </Link>
        <Link
          href="/admin/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            settingsActive
              ? "bg-gold-500 text-navy-900"
              : "text-foreground hover:bg-gold-50 hover:text-gold-700",
          )}
        >
          <Settings className="size-4 shrink-0" aria-hidden />
          {t("settings")}
        </Link>
        <button
          type="button"
          onClick={() => logout().then(() => router.replace("/login"))}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-danger-bg hover:text-danger transition-colors"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {t("logout")}
        </button>
      </div>
    </aside>
  );
}

export function AdminSidebar({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <Suspense fallback={<aside className="h-full w-60 border-r border-border bg-white" />}>
      <AdminSidebarInner onNavigate={onNavigate} />
    </Suspense>
  );
}
