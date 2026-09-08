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

function AdminSidebarInner() {
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
    <aside className="flex h-full w-60 flex-col bg-white border-r border-border">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
        <div className="flex size-10 items-center justify-center rounded-lg bg-gold-500 shrink-0">
          <Hotel className="size-5 text-navy-900" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight">{t("brandName")}</p>
          <p className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium">
            {t("brandSuite")}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = hrefIsActive(pathname, filter, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href + item.labelKey}>
                <Link
                  href={item.href}
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

      <div className="border-t border-border px-3 py-4 space-y-0.5">
        {customersEnabled && (
          <Link
            href="/admin/customers"
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

export function AdminSidebar() {
  return (
    <Suspense fallback={<aside className="h-full w-60 border-r border-border bg-white" />}>
      <AdminSidebarInner />
    </Suspense>
  );
}
