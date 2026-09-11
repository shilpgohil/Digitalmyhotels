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
    <aside className="flex h-full w-full flex-col sidebar-navy text-sidebar-foreground">
      {/* Brand — same structure as partner sidebar */}
      <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0">
        {/* Logo badge — gold with soft glow */}
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gold-500 shadow-[0_2px_10px_rgba(192,154,46,0.35)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dmh-icon.png"
            alt="DigitalMyHotels"
            className="size-full object-contain"
            draggable={false}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">DigitalMyHotels</p>
          <p className="truncate text-micro tracking-widest uppercase text-sidebar-foreground/70">Platform Admin</p>
        </div>
      </div>

      {/* Navigation — always expanded */}
      <nav className="scroll-fade-y overflow-y-auto px-3 py-2 flex-1">
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
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all duration-200",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_2px_14px_rgba(192,154,46,0.30)]"
                      : "text-sidebar-foreground hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop-only spacer: pushes footer to bottom on full-height sidebar.
          Hidden on mobile where the Sheet is h-auto (content-height). */}
      <div className="hidden lg:flex lg:flex-1" aria-hidden />

      <div className="border-t border-white/[0.08] px-3 py-3 space-y-0.5 flex-shrink-0">
        {customersEnabled && (
          <Link href="/admin/customers" onClick={onNavigate}
            className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all duration-200",
              customersActive ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_2px_14px_rgba(192,154,46,0.30)]" : "text-sidebar-foreground hover:bg-white/[0.06] hover:text-white")}>
            <Users className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t("allCustomersSection")}</span>
          </Link>
        )}
        <Link href="/admin/plans" onClick={onNavigate}
          className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all duration-200",
            plansActive ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_2px_14px_rgba(192,154,46,0.30)]" : "text-sidebar-foreground hover:bg-white/[0.06] hover:text-white")}>
          <CreditCard className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t("plans")}</span>
        </Link>
        <Link href="/admin/settings" onClick={onNavigate}
          className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all duration-200",
            settingsActive ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_2px_14px_rgba(192,154,46,0.30)]" : "text-sidebar-foreground hover:bg-white/[0.06] hover:text-white")}>
          <Settings className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t("settings")}</span>
        </Link>
        <button type="button" onClick={() => logout().then(() => router.replace("/login"))}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-sidebar-foreground hover:bg-danger/20 hover:text-white transition-all duration-200">
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t("logout")}</span>
        </button>
      </div>
    </aside>
  );
}

export function AdminSidebar({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <Suspense fallback={<aside className="h-full w-full sidebar-navy" />}>
      <AdminSidebarInner onNavigate={onNavigate} />
    </Suspense>
  );
}
