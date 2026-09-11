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
    <aside className={cn(
      "group flex h-full flex-col overflow-hidden",
      // Hover-expand: 56px collapsed → 220px expanded
      "w-[56px] hover:w-[212px]",
      "transition-[width] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.1)]",
      // Warm cream glass — same as partner sidebar
      "glass-sidebar-warm",
    )}>
      {/* Brand — logo always visible, "Platform Admin" text animates in */}
      {/* Brand — same structure as partner sidebar: icon + name + subtitle on hover */}
      <div className="flex items-center gap-2.5 px-3 py-4 flex-shrink-0">
        {/* Logo badge — matches partner's gold badge style */}
        <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gold-500 shadow-[0_2px_8px_rgba(192,154,46,0.35)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dmh-icon.png"
            alt="DigitalMyHotels"
            className="size-full object-contain"
            draggable={false}
          />
        </div>
        {/* Name + subtitle — animate in on hover */}
        <div className="min-w-0 overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-300 delay-50">
          <p className="truncate text-[11px] font-bold text-foreground whitespace-nowrap">DigitalMyHotels</p>
          <p className="truncate text-micro tracking-widest uppercase text-muted-foreground whitespace-nowrap">Platform Admin</p>
        </div>
      </div>

      {/* Navigation — labels animate in on hover */}
      <nav className="scroll-fade-y overflow-y-auto px-2 py-3 flex-1">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = hrefIsActive(pathname, filter, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href + item.labelKey}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  title={t(item.labelKey)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200",
                    active
                      ? "border-l-[2px] border-gold-500 bg-gold-100/70 pl-[9px] text-gold-800 font-semibold"
                      : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className={cn(
                    "whitespace-nowrap overflow-hidden transition-all duration-250",
                    "max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 delay-75",
                  )}>
                    {t(item.labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop-only spacer: pushes footer to bottom on full-height sidebar.
          Hidden on mobile where the Sheet is h-auto (content-height). */}
      <div className="hidden lg:flex lg:flex-1" aria-hidden />

      <div className="px-2 py-3 space-y-0.5 flex-shrink-0">
        {customersEnabled && (
          <Link href="/admin/customers" onClick={onNavigate} title={t("allCustomersSection")}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200",
              customersActive ? "border-l-[2px] border-gold-500 bg-gold-100/70 pl-[9px] text-gold-800 font-semibold" : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground")}>
            <Users className="size-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-250 delay-75">{t("allCustomersSection")}</span>
          </Link>
        )}
        <Link href="/admin/plans" onClick={onNavigate} title={t("plans")}
          className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200",
            plansActive ? "border-l-[2px] border-gold-500 bg-gold-100/70 pl-[9px] text-gold-800 font-semibold" : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground")}>
          <CreditCard className="size-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-250 delay-75">{t("plans")}</span>
        </Link>
        <Link href="/admin/settings" onClick={onNavigate} title={t("settings")}
          className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200",
            settingsActive ? "border-l-[2px] border-gold-500 bg-gold-100/70 pl-[9px] text-gold-800 font-semibold" : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground")}>
          <Settings className="size-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-250 delay-75">{t("settings")}</span>
        </Link>
        <button type="button" onClick={() => logout().then(() => router.replace("/login"))} title={t("logout")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-danger-bg hover:text-danger transition-all duration-200">
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-250 delay-75">{t("logout")}</span>
        </button>
      </div>
    </aside>
  );
}

export function AdminSidebar({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <Suspense fallback={<aside className="h-full w-[56px] glass-sidebar-warm flex-shrink-0" />}>
      <AdminSidebarInner onNavigate={onNavigate} />
    </Suspense>
  );
}
