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
  BookOpen,
  LayoutDashboard,
  LogIn,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

const TAB_ITEMS: readonly {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  permission: PermissionCode | null;
}[] = [
  {
    href: "/dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    permission: null,
  },
  {
    href: "/checkin",
    labelKey: "guestCheckin",  // nav.guestCheckin = "Guest Check-in"
    icon: LogIn,
    permission: PERMISSIONS.checkin,
  },
  {
    href: "/current-guests",
    labelKey: "currentGuests", // nav.currentGuests = "Current Guests"
    icon: Users,
    permission: PERMISSIONS.guestsView,
  },
  {
    href: "/advance-bookings",
    labelKey: "advanceBookings", // nav.advanceBookings = "Advance Bookings"
    icon: BookOpen,
    permission: PERMISSIONS.bookingsView,
  },
  {
    href: "/payments",
    labelKey: "payments",  // nav.payments = "Payment Details"
    icon: Wallet,
    permission: PERMISSIONS.paymentsView,
  },
] as const;

export function PartnerMobileTabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { can } = useAuth();

  // Attendance-only staff (general_staff): their home is My Attendance.
  const attendanceOnly =
    !can(PERMISSIONS.roomsView) &&
    !can(PERMISSIONS.bookingsView) &&
    can(PERMISSIONS.staffAttendanceSelf);

  const items = attendanceOnly
    ? [
        {
          href: "/my-attendance",
          labelKey: "myAttendance",
          icon: UserCheck,
          permission: null,
        },
      ]
    : TAB_ITEMS.filter((item) => item.permission === null || can(item.permission));

  return (
    /* Wrapper — centered pill, mobile only */
    <div className="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-35 w-[calc(100%-32px)] max-w-[440px]">
      <nav
        className="glass-tabbar-warm rounded-[999px] h-[56px] flex items-center justify-around px-2"
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
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-[999px] transition-all duration-200",
                active
                  ? "text-gold-700"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* Active dot indicator above icon */}
              <span
                className={cn(
                  "w-1 h-1 rounded-full transition-all duration-200 mb-0.5",
                  active ? "bg-gold-500 scale-100" : "scale-0",
                )}
                aria-hidden
              />
              <Icon
                className={cn(
                  "transition-all duration-200",
                  active ? "size-[18px]" : "size-4",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "text-[9px] font-semibold leading-none transition-all duration-200",
                  active ? "opacity-100" : "opacity-60",
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
