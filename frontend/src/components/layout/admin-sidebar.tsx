"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  PlusCircle,
  Hotel,
  CheckCircle,
  Clock,
  UserPlus,
  XCircle,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";

const NAV_ITEMS = [
  { href: "/admin", labelKey: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/add-hotel", labelKey: "addNewHotel", icon: PlusCircle },
  { href: "/admin/hotels?filter=all", labelKey: "totalHotelsNav", icon: Hotel, match: "/admin/hotels" },
  { href: "/admin/hotels", labelKey: "activeHotelsNav", icon: CheckCircle, exact: true },
  { href: "/admin/expired", labelKey: "recentlyExpiredNav", icon: Clock },
  { href: "/admin/registrations", labelKey: "recentRegistrationsNav", icon: UserPlus },
  { href: "/admin/expired?filter=all", labelKey: "expiredHotelsNav", icon: XCircle, match: "/admin/expired" },
] as const;

export function AdminSidebar() {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  const isActive = (item: { href: string; exact?: boolean; match?: string }) => {
    const target = item.match ?? item.href.split("?")[0];
    if (item.exact) return pathname === target;
    return pathname.startsWith(target);
  };

  return (
    <aside className="flex h-full w-60 flex-col bg-white border-r border-border">
      {/* Brand */}
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
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

      {/* Bottom actions */}
      <div className="border-t border-border px-3 py-4 space-y-0.5">
        <Link
          href="/admin/plans"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-gold-50 hover:text-gold-700 transition-colors"
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
