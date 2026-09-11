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
 *  2. Mobile drawer (navy sheet, same nav content)
 */
export function PartnerNav({ onNavigate }: { readonly onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <nav className="overflow-y-auto px-3 pb-4" aria-label="Main">
      {SECTIONS.map((section) => {
        const visible = section.items.filter(
          (item) => !item.permission || can(item.permission),
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.labelKey} className="mt-4 first:mt-0">
            {/* Section label — always visible (fixed expanded sidebar) */}
            <p className="px-2 pb-1 text-micro font-semibold tracking-widest uppercase text-sidebar-foreground/50">
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
                      onClick={onNavigate}
                      className={cn(
                        // Modern depth: smooth 180ms transitions, gold pill glow
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
    <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0">
      {/* Logo badge — gold with soft glow (modern depth touch) */}
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gold-500 font-display text-sm font-bold text-navy-900 shadow-[0_2px_10px_rgba(192,154,46,0.35)]">
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
      {/* Hotel name — always visible */}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{hotelName}</p>
        <p className="truncate text-micro tracking-widest uppercase text-sidebar-foreground/70">
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
      className="flex h-full w-full flex-col sidebar-navy text-sidebar-foreground"
      data-tour="sidebar"
    >
      {/* Brand */}
      <PartnerBrand />

      {/* Navigation — always expanded, labels always visible */}
      <PartnerNav />

      {/* Desktop spacer */}
      <div className="flex-1" aria-hidden />

      {/* Upgrade CTA */}
      {can(PERMISSIONS.hotelManageSettings) && (
        <div className="px-4 pb-2">
          <Link
            href="/plan"
            data-tour="upgrade-plan"
            className="flex items-center justify-center rounded-md bg-gold-500 px-3 py-2 text-sm font-semibold text-navy-900 shadow-[0_2px_10px_rgba(192,154,46,0.25)] transition-all duration-200 hover:bg-gold-400 hover:shadow-[0_4px_16px_rgba(192,154,46,0.35)] active:scale-[0.98]"
          >
            {t("upgradePlan")}
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className="border-t border-white/[0.08] px-4 py-4">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-4 shrink-0 opacity-70" aria-hidden />
          <div className="min-w-0">
            <p className="text-micro uppercase tracking-wider opacity-60">
              {t("loggedInAs")}
            </p>
            <p className="truncate text-sm font-medium text-white">{user?.full_name}</p>
            {roleName && (
              <p className="truncate text-xs opacity-70">{roleName}</p>
            )}
          </div>
        </div>
        {/* Powered by DMH badge */}
        <div className="mt-3 flex items-center gap-1.5 opacity-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dmh-icon.png"
            alt=""
            width={14}
            height={14}
            className="size-3.5 select-none object-contain"
            style={{ filter: "brightness(0) invert(1)" }}
            draggable={false}
          />
          <p className="text-[9px] tracking-widest uppercase font-medium text-sidebar-foreground">
            Powered by DigitalMyHotels
          </p>
        </div>
      </div>
    </aside>
  );
}
