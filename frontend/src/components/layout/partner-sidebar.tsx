"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
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
  UserCog,
  UserRound,
  Bell,
  ClipboardCheck,
  ArrowLeftRight,
  ScrollText,
  UtensilsCrossed,
  ReceiptText,
  Landmark,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { useApi } from "@/lib/api/use-api";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import type { HotelOut } from "@/types/hotel";

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
      {
        href: "/edit-hotel",
        labelKey: "editHotel",
        icon: Building2,
        permission: PERMISSIONS.hotelManageSettings,
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
        href: "/restaurant-billing",
        labelKey: "restaurantBilling",
        icon: UtensilsCrossed,
        permission: PERMISSIONS.financialReports,
      },
      {
        href: "/gst-tax",
        labelKey: "gstTax",
        icon: Landmark,
        permission: PERMISSIONS.financialReports,
      },
      {
        href: "/invoice-preview",
        labelKey: "invoicePreview",
        icon: ReceiptText,
        permission: PERMISSIONS.invoicesManage,
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
        href: "/team",
        labelKey: "team",
        icon: UserCog,
        permission: PERMISSIONS.hotelManageTeam,
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

/**
 * Shared navigation sections — rendered by both the desktop sidebar and the
 * mobile drawer so active-route highlighting and permission gating stay in
 * sync. `onNavigate` lets the mobile drawer close itself on item click.
 */
/**
 * Partner navigation — works in two modes:
 *  1. Desktop hover-expand sidebar (controlled by CSS group on <aside>)
 *  2. Mobile drawer (full width, labels always visible via `alwaysExpanded`)
 */
export function PartnerNav({
  onNavigate,
  alwaysExpanded = false,
}: {
  readonly onNavigate?: () => void;
  readonly alwaysExpanded?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <nav className="scroll-fade-y overflow-y-auto pb-4 flex-1" aria-label="Main">
      {SECTIONS.map((section) => {
        const visible = section.items.filter(
          (item) => !item.permission || can(item.permission),
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.labelKey} className="mt-3 first:mt-0">
            {/* Section label — hidden when sidebar collapsed, visible on hover/expanded */}
            <p className={cn(
              "px-3 pb-1 text-micro font-semibold tracking-widest uppercase text-muted-foreground/55 whitespace-nowrap transition-all duration-200",
              alwaysExpanded
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 delay-75",
            )}>
              {t(section.labelKey)}
            </p>
            <ul className="space-y-0.5 px-2">
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
                      onClick={onNavigate}
                      title={alwaysExpanded ? undefined : t(item.labelKey)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200",
                        active
                          ? "border-l-[2px] border-gold-500 bg-gold-100/70 pl-[9px] font-semibold text-gold-800"
                          : "hover:bg-black/[0.04] hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {/* Label: animates in on hover for desktop, always shown for mobile drawer */}
                      <span className={cn(
                        "whitespace-nowrap overflow-hidden transition-all duration-250",
                        alwaysExpanded
                          ? "max-w-[160px] opacity-100"
                          : "max-w-0 opacity-0 group-hover:max-w-[160px] group-hover:opacity-100 delay-75",
                      )}>
                        {t(item.labelKey)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Monogram of the hotel name's initials, e.g. "MC" for "Meridian Court". */
function hotelInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "DM";
}

/**
 * Brand block shared by the desktop sidebar and the mobile drawer header.
 * Shows the active hotel's name and uploaded logo (client request, 09/2026);
 * falls back to the product name / a name monogram while loading or when no
 * logo has been uploaded yet.
 */
export function PartnerBrand() {
  const api = useApi();
  const { activeHotelId } = useAuth();

  // Same query key as Edit Hotel / Settings so the name updates instantly
  // after a profile save (those pages invalidate ["hotel", activeHotelId]).
  const hotel = useQuery({
    queryKey: ["hotel", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
  });

  // Protected image bytes → blob URL (same pattern as the payment-QR fetches).
  // Returns null on 404 (no logo uploaded) so the monogram fallback shows.
  const logo = useQuery({
    queryKey: ["hotel-logo", activeHotelId],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/logo/image?v=${Date.now()}`, {
        headers,
        credentials: "include",
        cache: "no-store",
      });
      if (!resp.ok) return null;
      return URL.createObjectURL(await resp.blob());
    },
    enabled: !!activeHotelId,
    staleTime: 5 * 60 * 1000,
  });

  const hotelName = hotel.data?.name?.trim() || "DigitalMyHotels";

  return (
    <div className="flex items-center gap-2.5 px-3 py-4 flex-shrink-0">
      {/* Logo — always visible at 32px */}
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gold-500 font-display text-[10px] font-black text-navy-900 shadow-[0_2px_8px_rgba(192,154,46,0.35)]">
        {logo.data ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.data}
            alt={hotelName}
            className="size-full bg-white object-contain"
          />
        ) : (
          hotelInitials(hotelName)
        )}
      </div>
      {/* Hotel name — animates in on hover */}
      <div className="min-w-0 overflow-hidden max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-300 delay-50">
        <p className="truncate text-[11px] font-bold text-foreground whitespace-nowrap">{hotelName}</p>
        <p className="truncate text-micro tracking-widest uppercase text-muted-foreground whitespace-nowrap">
          Front Desk Suite
        </p>
      </div>
    </div>
  );
}

export function PartnerSidebar() {
  const t = useTranslations("nav");
  const { user, can, memberships, activeHotelId } = useAuth();

  // Designation shown under the user's name (client request, 09/2026) —
  // the role held at the active hotel, e.g. "Hotel Owner" / "Manager".
  const roleName = memberships.find((m) => m.hotel_id === activeHotelId)?.role_name;

  return (
    <aside
      className={cn(
        // Base: collapsed icon strip
        "group flex h-full flex-col overflow-hidden",
        // Width: springs from 56px to 212px on hover
        "w-[56px] hover:w-[212px]",
        "transition-[width] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.1)]",
        // Warm cream frosted glass
        "glass-sidebar-warm",
        // Text default
        "text-foreground",
      )}
      data-tour="sidebar"
    >
      {/* Brand */}
      <PartnerBrand />

      {/* Navigation — labels animate in via group-hover */}
      <PartnerNav />

      {/* Desktop spacer */}
      <div className="flex-1" aria-hidden />

      {/* Upgrade CTA — label animates in */}
      {can(PERMISSIONS.hotelManageSettings) && (
        <div className="px-2 pb-2">
          <Link
            href="/plan"
            data-tour="upgrade-plan"
            className="flex items-center gap-2 rounded-lg bg-gold-500 px-2.5 py-2 text-sm font-semibold text-navy-900 shadow-surface transition-all duration-180 hover:bg-gold-400 hover:shadow-card overflow-hidden"
            title={t("upgradePlan")}
          >
            <span className="text-base shrink-0">⬆</span>
            <span className="whitespace-nowrap overflow-hidden max-w-0 opacity-0 group-hover:max-w-[130px] group-hover:opacity-100 transition-all duration-250 delay-75">
              {t("upgradePlan")}
            </span>
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className="px-2 py-3">
        <div className="flex items-center gap-2.5 px-0.5">
          {/* Avatar — always visible */}
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900/10">
            <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
          </div>
          {/* Details — animate in on hover */}
          <div className="min-w-0 overflow-hidden max-w-0 opacity-0 group-hover:max-w-[140px] group-hover:opacity-100 transition-all duration-300 delay-75">
            <p className="text-micro uppercase tracking-wider text-muted-foreground/65 whitespace-nowrap">
              {t("loggedInAs")}
            </p>
            <p className="truncate text-xs font-semibold text-foreground whitespace-nowrap">{user?.full_name}</p>
            {roleName && (
              <p className="truncate text-micro text-muted-foreground whitespace-nowrap">{roleName}</p>
            )}
          </div>
        </div>
        {/* Powered by — only visible when expanded */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-hidden max-w-0 opacity-0 group-hover:max-w-[180px] group-hover:opacity-30 transition-all duration-300 delay-100 px-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dmh-icon.png"
            alt=""
            width={12}
            height={12}
            className="size-3 select-none object-contain flex-shrink-0"
            style={{ filter: "brightness(0)" }}
            draggable={false}
          />
          <p className="text-micro tracking-widest uppercase font-medium text-foreground whitespace-nowrap">
            Powered by DigitalMyHotels
          </p>
        </div>
      </div>
    </aside>
  );
}
