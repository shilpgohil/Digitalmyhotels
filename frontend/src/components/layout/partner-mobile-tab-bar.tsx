"use client";
/**
 * PartnerMobileTabBar — Apple-style floating glass pill tab bar.
 *
 * Shown ONLY on mobile (lg:hidden). Appears at the bottom of the screen as a
 * frosted white glass pill. Uses the same active-route detection as the sidebar.
 * The 5 most-used partner routes are shown; everything else is accessible via
 * the hamburger that opens the full sidebar drawer.
 *
 * Design: White frost glass (Option E) with gold glow active state.
 * z-index: 35 — above content (z-0), below dialogs (z-50), below edge vignette (z-15).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BedDouble,
  BookOpen,
  LayoutDashboard,
  LogIn,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

/**
 * Tab candidates in PRIORITY order — the bar shows the first 5 the current
 * role is allowed to use, so every hotel member gets a bar that matches
 * their job (client 09/2026: role-respective bottom bar; staff attendance
 * is a priority destination for everyone).
 *
 * requiresFullAccess: when true, the tab is hidden unless the hotel's
 * access_mode is "full" (same gate as the sidebar + route guards).
 */
const TAB_CANDIDATES: readonly {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  permission: PermissionCode | null;
  requiresFullAccess?: true;
}[] = [
  {
    href: "/dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    permission: null,
  },
  {
    href: "/my-attendance",
    labelKey: "attendance",
    icon: UserCheck,
    permission: PERMISSIONS.staffAttendanceSelf,
    // Staff attendance is only available when the hotel has full access mode.
    requiresFullAccess: true,
  },
  {
    href: "/checkin",
    labelKey: "checkin",
    icon: LogIn,
    permission: PERMISSIONS.checkin,
  },
  {
    href: "/current-guests",
    labelKey: "guests",
    icon: Users,
    permission: PERMISSIONS.guestsView,
  },
  {
    href: "/advance-bookings",
    labelKey: "bookings",
    icon: BookOpen,
    permission: PERMISSIONS.bookingsView,
  },
  {
    href: "/payments",
    labelKey: "paymentsShort",
    icon: Wallet,
    permission: PERMISSIONS.paymentsView,
  },
  // Housekeeping-oriented tabs — surface when front-desk tabs are not allowed.
  {
    href: "/rooms",
    labelKey: "rooms",
    icon: BedDouble,
    permission: PERMISSIONS.roomsView,
  },
  {
    href: "/housekeeping",
    labelKey: "housekeeping",
    icon: Sparkles,
    permission: PERMISSIONS.housekeepingManage,
  },
] as const;

const MAX_TABS = 5;

export function PartnerMobileTabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { can, accessMode } = useAuth();

  // Attendance-only staff (general_staff) on a FULL-ACCESS hotel: their home
  // IS My Attendance — a Dashboard tab would only bounce them back there.
  const attendanceOnly =
    accessMode === "full" &&
    !can(PERMISSIONS.roomsView) &&
    !can(PERMISSIONS.bookingsView) &&
    can(PERMISSIONS.staffAttendanceSelf);

  const items = attendanceOnly
    ? TAB_CANDIDATES.filter((item) => item.href === "/my-attendance")
    : TAB_CANDIDATES.filter(
        (item) =>
          (item.permission === null || can(item.permission)) &&
          // Gate staff-attendance tabs by hotel access_mode — mirrors the
          // sidebar filter so checkin_only/checkin_expense hotels never see
          // My Attendance in the mobile bottom bar (screenshot 19/09/2026).
          !(item.requiresFullAccess && accessMode !== "full"),
      ).slice(0, MAX_TABS);

  return (
    /* Wrapper — centered pill, mobile only, pointer-events-none so margins don't block clicks */
    <div className="lg:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-35 w-[calc(100%-20px)] max-w-[430px] pointer-events-none select-none">
      <nav
        className="pointer-events-auto glass-tabbar-warm border border-slate-900/[0.08] dark:border-white/[0.1] rounded-full h-[60px] flex items-stretch justify-around px-1 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.12)]"
        aria-label="Mobile navigation"
      >
        {items.map(({ href, labelKey, icon: Icon }) => {
          // Longest-prefix wins so nested routes never light two tabs at once.
          const matches = items
            .map((i) => i.href)
            .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
            .sort((a, b) => b.length - a.length);
          const active = matches[0] === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex-1 min-w-0 h-full flex flex-col items-center justify-center py-1.5 px-0.5 rounded-full transition-all duration-150",
                active
                  ? "text-amber-800 dark:text-amber-300"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
              )}
            >
              {/* Active subtle pill glow / indicator at the top — absolute so it never shifts the icon */}
              {active && (
                <span
                  className="absolute top-1.5 w-6 h-[2.5px] rounded-full bg-amber-600 dark:bg-amber-400 shadow-[0_1px_4px_rgba(217,119,6,0.35)]"
                  aria-hidden
                />
              )}

              {/* Fixed height icon container to prevent any vertical shift across tabs */}
              <div className="flex items-center justify-center h-6 w-full mt-0.5">
                <Icon
                  className={cn(
                    "transition-transform duration-150 size-[19px]",
                    active ? "scale-105 stroke-[2.2] text-amber-700 dark:text-amber-400" : "stroke-[1.8]",
                  )}
                  aria-hidden
                />
              </div>

              {/* Fixed single-line label with whitespace-nowrap and truncate */}
              <span
                className={cn(
                  "w-full text-center text-[10px] tracking-tight leading-none truncate px-0.5 whitespace-nowrap mt-1",
                  active ? "font-bold text-amber-900 dark:text-amber-200" : "font-medium opacity-75",
                )}
              >
                {t(labelKey)}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
