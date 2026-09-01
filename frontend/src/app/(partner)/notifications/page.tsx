"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import { fmtDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { NotificationOut } from "@/components/layout/notifications-bell";

const CATEGORIES = [
  { key: "", labelKey: "cat_all" },
  { key: "front_desk", labelKey: "cat_front_desk" },
  { key: "housekeeping", labelKey: "cat_housekeeping" },
  { key: "finance", labelKey: "cat_finance" },
  { key: "operations", labelKey: "cat_operations" },
  { key: "admin", labelKey: "cat_admin" },
  { key: "platform", labelKey: "cat_platform" },
];

const DOT: Record<string, string> = {
  front_desk: "bg-amber-400",
  housekeeping: "bg-blue-400",
  finance: "bg-emerald-400",
  operations: "bg-purple-400",
  admin: "bg-navy-600",
  platform: "bg-indigo-400",
};

const ROW_BG: Record<string, string> = {
  front_desk: "border-l-amber-400",
  housekeeping: "border-l-blue-400",
  finance: "border-l-emerald-400",
  operations: "border-l-purple-400",
  admin: "border-l-navy-600",
  platform: "border-l-indigo-400",
};

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

function NotificationsContent() {
  const t = useTranslations("notifications");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const router = useRouter();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState("");

  const qs = activeCategory ? `?category=${activeCategory}` : "";

  const notifications = useQuery({
    queryKey: ["notifications-page", activeHotelId, activeCategory],
    queryFn: () =>
      api<{ items: NotificationOut[]; total: number; unread: number }>(
        `/api/v1/notifications${qs}`,
      ),
    enabled: !!activeHotelId,
  });

  const markOne = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["notifications-page", activeHotelId] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api("/api/v1/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["notifications-page", activeHotelId] });
    },
  });

  const handleNavigate = (n: NotificationOut) => {
    if (!n.is_read) markOne.mutate(n.id);
    if (!n.deep_link) return;
    const required = DEEP_LINK_PERMISSION.find(([re]) => re.test(n.deep_link!))?.[1];
    if (required && !can(required)) return;
    router.push(n.deep_link);
  };

  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unread ?? 0;

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("overview")} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Category filter chips */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  activeCategory === cat.key
                    ? "border-navy-900 bg-navy-900 font-medium text-white"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {cat.key && (
                  <span className={cn("size-2 rounded-full", DOT[cat.key])} aria-hidden />
                )}
                {t(cat.labelKey)}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <Check className="size-3.5" aria-hidden />
              {t("markAllRead")}
            </Button>
          )}
        </div>

        {/* List */}
        <div className="space-y-1 rounded-lg border bg-card">
          {notifications.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded" />
              ))}
            </div>
          )}
          {notifications.isError && (
            <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {tc("error")}
            </p>
          )}
          {!notifications.isLoading && !notifications.isError && items.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          )}
          {items.map((n) => {
            const borderColor = ROW_BG[n.category] ?? "border-l-muted";
            const hasLink = !!n.deep_link && (() => {
              const required = DEEP_LINK_PERMISSION.find(([re]) =>
                re.test(n.deep_link!),
              )?.[1];
              return !required || can(required);
            })();

            return (
              <button
                key={n.id}
                type="button"
                className={cn(
                  "flex w-full items-start gap-3 border-b border-l-[3px] p-4 text-left transition-colors hover:bg-muted/50 last:border-b-0",
                  borderColor,
                  !n.is_read && "bg-muted/20",
                )}
                onClick={() => handleNavigate(n)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!n.is_read && (
                      <span
                        className={cn(
                          "inline-block size-2 shrink-0 rounded-full",
                          DOT[n.category] ?? "bg-muted-foreground",
                        )}
                        aria-hidden
                      />
                    )}
                    <p
                      className={cn(
                        "text-sm leading-snug",
                        !n.is_read && "font-semibold",
                      )}
                    >
                      {n.title}
                    </p>
                    {hasLink && (
                      <ExternalLink
                        className="ml-auto size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {fmtDateTime(n.created_at)}
                    {!hasLink && n.deep_link && (
                      <span className="ml-2 text-muted-foreground/50">
                        ({tc("unauthorized")})
                      </span>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </>
  );
}

export default function NotificationsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.notificationsView}>
      <NotificationsContent />
    </RequirePermission>
  );
}
