"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  LogIn,
  LogOut,
  Users,
  BedDouble,
  CalendarPlus,
  CalendarClock,
  CalendarCheck,
  Wallet,
  FileText,
  Receipt,
  Sparkles,
  BarChart3,
  Settings,
  UserRound,
  Bell,
  ClipboardCheck,
  ArrowLeftRight,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: PermissionCode;
}

interface NavSection {
  labelKey: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    labelKey: "overview",
    items: [
      { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
      {
        href: "/expenses",
        labelKey: "expenses",
        icon: Receipt,
        permission: PERMISSIONS.expensesView,
      },
    ],
  },
  {
    labelKey: "frontDesk",
    items: [
      {
        href: "/checkin",
        labelKey: "guestCheckin",
        icon: LogIn,
        permission: PERMISSIONS.checkin,
      },
      {
        href: "/checkout",
        labelKey: "guestCheckout",
        icon: LogOut,
        permission: PERMISSIONS.checkout,
      },
      {
        href: "/current-guests",
        labelKey: "currentGuests",
        icon: Users,
        permission: PERMISSIONS.guestsView,
      },
      {
        href: "/advance-booking",
        labelKey: "advanceBooking",
        icon: CalendarPlus,
        permission: PERMISSIONS.bookingsView,
      },
      {
        href: "/advance-bookings",
        labelKey: "advanceBookings",
        icon: CalendarClock,
        permission: PERMISSIONS.bookingsView,
      },
      {
        href: "/completed-bookings",
        labelKey: "completedBookings",
        icon: CalendarCheck,
        permission: PERMISSIONS.bookingsView,
      },
    ],
  },
  {
    labelKey: "property",
    items: [
      {
        href: "/rooms",
        labelKey: "roomStatus",
        icon: BedDouble,
        permission: PERMISSIONS.roomsView,
      },
      {
        href: "/housekeeping",
        labelKey: "housekeeping",
        icon: Sparkles,
        permission: PERMISSIONS.housekeepingManage,
      },
    ],
  },
  {
    labelKey: "money",
    items: [
      {
        href: "/payments",
        labelKey: "payments",
        icon: Wallet,
        permission: PERMISSIONS.paymentsView,
      },
      {
        href: "/invoices",
        labelKey: "invoices",
        icon: FileText,
        permission: PERMISSIONS.invoicesManage,
      },
    ],
  },
  {
    labelKey: "operations",
    items: [
      {
        href: "/reports",
        labelKey: "reports",
        icon: BarChart3,
        permission: PERMISSIONS.reportsView,
      },
      {
        href: "/daily-closing",
        labelKey: "dailyClosing",
        icon: ClipboardCheck,
        permission: PERMISSIONS.dailyClosing,
      },
      {
        href: "/shift-handover",
        labelKey: "shiftHandover",
        icon: ArrowLeftRight,
        permission: PERMISSIONS.shiftHandover,
      },
      {
        href: "/notifications",
        labelKey: "notifications",
        icon: Bell,
        permission: PERMISSIONS.notificationsView,
      },
      {
        href: "/audit",
        labelKey: "auditLogs",
        icon: ScrollText,
        permission: PERMISSIONS.auditView,
      },
      {
        href: "/settings",
        labelKey: "settings",
        icon: Settings,
        permission: PERMISSIONS.hotelView,
      },
    ],
  },
];

export function PartnerSidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { user, can } = useAuth();

  return (
    <aside
      className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground"
      data-tour="sidebar"
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gold-500 font-display text-sm font-bold text-navy-900">
          DM
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">DigitalMyHotels</p>
          <p className="truncate text-[10px] tracking-widest uppercase">
            Front Desk Suite
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SECTIONS.map((section) => {
          const visible = section.items.filter(
            (item) => !item.permission || can(item.permission),
          );
          if (visible.length === 0) return null;
          return (
            <div key={section.labelKey} className="mt-4 first:mt-0">
              <p className="px-2 pb-1 text-[10px] font-semibold tracking-widest uppercase opacity-60">
                {t(section.labelKey)}
              </p>
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-tour={`nav-${item.href.replace("/", "")}`}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                          active
                            ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Upgrade plan CTA */}
      {can(PERMISSIONS.hotelManageSettings) && (
        <div className="px-4 pb-2">
          <Link
            href="/plan"
            data-tour="upgrade-plan"
            className="flex items-center justify-center rounded-md bg-gold-500 px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400"
          >
            {t("upgradePlan")}
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-4 shrink-0 opacity-70" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider opacity-60">
              {t("loggedInAs")}
            </p>
            <p className="truncate text-sm font-medium text-white">{user?.full_name}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
