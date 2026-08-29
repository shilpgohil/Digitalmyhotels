"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge, ROOM_STATUS_TONE } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut, RoomOut } from "@/types/hotel";
import type { HousekeepingTaskOut, MaintenanceOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";

function HousekeepingContent() {
  const t = useTranslations("ops");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: ["hk-tasks", activeHotelId],
    queryFn: () => api<HousekeepingTaskOut[]>("/api/v1/housekeeping/tasks"),
    enabled: !!activeHotelId,
  });
  const maintenance = useQuery({
    queryKey: ["maintenance", activeHotelId],
    queryFn: () => api<MaintenanceOut[]>("/api/v1/housekeeping/maintenance"),
    enabled: !!activeHotelId && can(PERMISSIONS.maintenanceManage),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["hk-tasks", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["maintenance", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  const start = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/housekeeping/tasks/${id}/start`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success(t("started"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });
  const complete = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/housekeeping/tasks/${id}/complete`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("completed"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/housekeeping/maintenance/${id}/resolve`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("resolved"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("housekeepingTitle")} subtitle={tn("property")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex justify-end">
          {can(PERMISSIONS.maintenanceManage) && <OpenMaintenanceDialog onDone={invalidate} />}
        </div>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("tasks")}</h2>
          {tasks.isLoading && <Skeleton className="h-32" />}
          {tasks.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          )}
          <ul className="space-y-2">
            {tasks.data?.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                <div>
                  <p className="font-medium">
                    {t("room")} {task.room_number ?? task.room_id.slice(0, 8)}
                  </p>
                  <StatusBadge tone={ROOM_STATUS_TONE[task.status] ?? "neutral"}>
                    {t(`hk_${task.status}`)}
                  </StatusBadge>
                </div>
                <div className="space-x-2">
                  {task.status === "cleaning_required" && (
                    <Button size="sm" onClick={() => start.mutate(task.id)}>
                      {t("start")}
                    </Button>
                  )}
                  {(task.status === "cleaning_in_progress" || task.status === "cleaning_required") && (
                    <Button size="sm" variant="outline" onClick={() => complete.mutate(task.id)}>
                      {t("complete")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
        {maintenance.data && (
          <section className="mt-6 rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{t("maintenance")}</h2>
            {maintenance.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noMaintenance")}</p>
            )}
            <ul className="space-y-2">
              {maintenance.data.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>
                    {m.reason} · {m.status}
                  </span>
                  {m.status !== "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => resolve.mutate(m.id)}>
                      {t("resolve")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function OpenMaintenanceDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("ops");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [reason, setReason] = useState("");

  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: open && !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/housekeeping/maintenance", {
        method: "POST",
        body: { room_id: roomId, reason },
      }),
    onSuccess: () => {
      toast.success(t("maintenanceOpened"));
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
        {t("openMaintenance")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("openMaintenance")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("room")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border px-2.5 text-sm"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">—</option>
              {rooms.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t("reason")}</Label>
            <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button disabled={!roomId || reason.length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>
            {t("openMaintenance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HousekeepingPage() {
  return (
    <RequirePermission permission={PERMISSIONS.housekeepingManage}>
      <HousekeepingContent />
    </RequirePermission>
  );
}
