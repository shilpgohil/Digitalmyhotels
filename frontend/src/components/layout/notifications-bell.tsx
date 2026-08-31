"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  DollarSign,
  Settings,
  Layers,
  LayoutDashboard,
  Check,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationOut {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  deep_link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

interface NotificationList {
  items: NotificationOut[];
  total: number;
  unread: number;
}

// ---------------------------------------------------------------------------
// Category config: colour token + icon + label
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<
  string,
  { bg: string; dot: string; icon: React.ComponentType<{ className?: string }>; labelKey: string }
> = {
  front_desk: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    dot: "bg-amber-400",
    icon: Building2,
    labelKey: "cat_front_desk",
  },
  housekeeping: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    dot: "bg-blue-400",
    icon: Sparkles,
    labelKey: "cat_housekeeping",
  },
  finance: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    dot: "bg-emerald-400",
    icon: DollarSign,
    labelKey: "cat_finance",
  },
  operations: {
    bg: "bg-purple-50 dark:bg-purple-900/20",
    dot: "bg-purple-400",
    icon: Layers,
    labelKey: "cat_operations",
  },
  admin: {
    bg: "bg-navy-50 dark:bg-navy-900/20",
    dot: "bg-navy-600",
    icon: Settings,
    labelKey: "cat_admin",
  },
  platform: {
    bg: "bg-indigo-50 dark:bg-indigo-900/20",
    dot: "bg-indigo-400",
    icon: LayoutDashboard,
    labelKey: "cat_platform",
  },
};

const DEFAULT_CATEGORY = CATEGORY_CONFIG.front_desk;

// ---------------------------------------------------------------------------
// Deep-link permission map: which permission is needed to navigate to a URL
// ---------------------------------------------------------------------------

const DEEP_LINK_PERMISSION: [RegExp, string][] = [
  [/^\/bookings/, PERMISSIONS.bookingsView],
  [/^\/current-guests/, PERMISSIONS.guestsView],
  [/^\/housekeeping/, PERMISSIONS.housekeepingManage],
  [/^\/payments/, PERMISSIONS.paymentsView],
  [/^\/invoices/, PERMISSIONS.invoicesManage],
  [/^\/expenses/, PERMISSIONS.expensesView],
  [/^\/daily-closing/, PERMISSIONS.dailyClosing],
  [/^\/shift-handover/, PERMISSIONS.shiftHandover],
  [/^\/team/, PERMISSIONS.hotelManageTeam],
  [/^\/settings/, PERMISSIONS.hotelView],
  [/^\/plan/, PERMISSIONS.hotelView],
];

function useDeepLink() {
  const { can } = useAuth();

  return useCallback(
    (link: string | null) => {
      if (!link) return null;
      const required = DEEP_LINK_PERMISSION.find(([re]) => re.test(link))?.[1];
      if (required && !can(required)) {
        // User can read the notification but not navigate to that page.
        return null;
      }
      return link;
    },
    [can],
  );
}

// ---------------------------------------------------------------------------
// Individual notification row
// ---------------------------------------------------------------------------

function NotifRow({
  n,
  categoryLabel,
  onMarkRead,
}: {
  readonly n: NotificationOut;
  /** Pre-translated category label from the parent (avoids nested useTranslations). */
  readonly categoryLabel: string;
  readonly onMarkRead: (id: string) => void;
}) {
  const router = useRouter();
  const resolveLink = useDeepLink();
  const cfg = CATEGORY_CONFIG[n.category] ?? DEFAULT_CATEGORY;
  const Icon = cfg.icon;
  const link = resolveLink(n.deep_link);

  const handleClick = () => {
    if (!n.is_read) onMarkRead(n.id);
    if (link) router.push(link);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        n.is_read ? "opacity-60" : "",
        cfg.bg,
      )}
    >
      {/* Category colour dot */}
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          n.is_read ? "bg-muted-foreground/40" : cfg.dot,
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-snug", !n.is_read && "font-semibold")}>
          {n.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {n.body}
        </p>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Icon className="size-3 shrink-0" aria-hidden />
          <span>{categoryLabel}</span>
          <span className="ml-auto">{fmtDateTime(n.created_at)}</span>
          {link && <ExternalLink className="size-3 shrink-0" aria-hidden />}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main bell component
// ---------------------------------------------------------------------------

export function NotificationsBell() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!activeHotelId && can(PERMISSIONS.notificationsView);

  const notifications = useQuery({
    queryKey: ["notifications", activeHotelId],
    queryFn: () => api<NotificationList>("/api/v1/notifications?limit=40"),
    enabled,
    refetchInterval: 30_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications", activeHotelId] }),
  });

  const markAll = useMutation({
    mutationFn: () => api("/api/v1/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications", activeHotelId] }),
  });

  // ── Per-category expand/collapse state ────────────────────────────────────
  // collapsedCategories = set of category keys the user has manually closed.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // expandedItems = categories where the user clicked "show more"
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());


  const toggleShowMore = (cat: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });

  const unread = notifications.data?.unread ?? 0;
  const all = notifications.data?.items ?? [];

  // Group items by category, unread categories first.
  const grouped = Object.entries(
    all.reduce<Record<string, NotificationOut[]>>((acc, n) => {
      if (!acc[n.category]) acc[n.category] = [];
      acc[n.category].push(n);
      return acc;
    }, {}),
  ).sort(([, aItems], [, bItems]) => {
    const aUnread = aItems.some((i) => !i.is_read) ? 0 : 1;
    const bUnread = bItems.some((i) => !i.is_read) ? 0 : 1;
    return aUnread - bUnread;
  });

  // Auto-collapse fully-read categories when data first loads.
  useEffect(() => {
    if (!notifications.data) return;
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      Object.entries(
        notifications.data.items.reduce<Record<string, NotificationOut[]>>((acc, n) => {
          if (!acc[n.category]) acc[n.category] = [];
          acc[n.category].push(n);
          return acc;
        }, {}),
      ).forEach(([cat, items]) => {
        const hasUnread = items.some((i) => !i.is_read);
        if (!hasUnread && !prev.has(cat + ":opened")) next.add(cat);
        if (hasUnread) next.delete(cat);
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.dataUpdatedAt]);

  if (!enabled) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex size-9 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground"
        aria-label={t("title")}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="flex w-[340px] flex-col overflow-hidden p-0 shadow-lg"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{t("title")}</p>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                <Check className="size-3" aria-hidden />
                {t("markAllRead")}
              </button>
            )}
            <button
              type="button"
              className="text-[11px] text-gold-600 hover:underline"
              onClick={() => router.push("/notifications")}
            >
              {t("viewAll")}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[440px] overflow-y-auto">
          {all.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          )}

          {grouped.map(([category, items]) => {
            const cfg = CATEGORY_CONFIG[category] ?? DEFAULT_CATEGORY;
            const Icon = cfg.icon;
            const catUnread = items.filter((i) => !i.is_read).length;
            const isCollapsed = collapsedCategories.has(category);
            const isShowingMore = expandedItems.has(category);
            const PREVIEW_COUNT = 4;
            const visibleItems = isShowingMore ? items : items.slice(0, PREVIEW_COUNT);
            const hasMore = items.length > PREVIEW_COUNT;

            return (
              <div key={category} className="border-b last:border-b-0">
                {/* ── Clickable category header (accordion toggle) ─────── */}
                <button
                  type="button"
                  onClick={() => {
                    // Single atomic update: toggle collapsed + track manual interaction
                    setCollapsedCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(category)) {
                        next.delete(category);
                        // Mark as manually opened so auto-collapse won't close it again
                        next.add(category + ":opened");
                      } else {
                        next.add(category);
                        next.delete(category + ":opened");
                      }
                      return next;
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
                    {t(cfg.labelKey)}
                  </span>
                  {/* Unread badge */}
                  {catUnread > 0 && (
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0",
                        cfg.dot,
                      )}
                    >
                      {catUnread > 9 ? "9+" : catUnread}
                    </span>
                  )}
                  {/* Total count when collapsed */}
                  {isCollapsed && catUnread === 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {items.length}
                    </span>
                  )}
                  {/* Chevron */}
                  {isCollapsed
                    ? <ChevronRight className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
                    : <ChevronDown className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
                  }
                </button>

                {/* ── Expandable items ─────────────────────────────────── */}
                {!isCollapsed && (
                  <div>
                    {visibleItems.map((n) => (
                      <NotifRow
                        key={n.id}
                        n={n}
                        categoryLabel={t(cfg.labelKey)}
                        onMarkRead={(id) => markOne.mutate(id)}
                      />
                    ))}
                    {hasMore && (
                      <button
                        type="button"
                        onClick={() => toggleShowMore(category)}
                        className="w-full px-3 py-1.5 text-[11px] text-gold-600 font-medium hover:bg-muted/40 transition-colors text-center"
                      >
                        {isShowingMore
                          ? "Show less"
                          : `Show ${items.length - PREVIEW_COUNT} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
