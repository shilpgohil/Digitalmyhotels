"use client";

/**
 * LeaveSection — staff self-service leave requests (My Attendance page).
 * Apply dialog (range + type + reason) and the user's own request list.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fmtApiDate, localToday } from "@/lib/formatting";
import { LEAVE_TYPES, type LeaveListOut, type LeaveOut } from "@/types/staff";

const STATUS_TONE: Record<LeaveOut["status"], "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export function LeaveSection() {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const leaves = useQuery({
    queryKey: ["staff-leaves", activeHotelId, "mine"],
    queryFn: () => api<LeaveListOut>("/api/v1/staff/leaves?mine=true&limit=10"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api<LeaveOut>("/api/v1/staff/leaves", {
        method: "POST",
        body: {
          from_date: fromDate,
          to_date: toDate,
          leave_type: leaveType,
          reason: reason.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("leaveAppliedToast"));
      setOpen(false);
      setFromDate("");
      setToDate("");
      setReason("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["staff-leaves", activeHotelId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{t("myLeaves")}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-sm font-medium transition-colors hover:bg-muted">
            <CalendarPlus className="size-4" aria-hidden />
            {t("applyLeave")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("applyLeaveTitle")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lv-from">{t("fromDate")}</Label>
                  <DatePicker
                    id="lv-from"
                    value={fromDate}
                    onChange={setFromDate}
                    min={localToday()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lv-to">{t("toDate")}</Label>
                  <DatePicker
                    id="lv-to"
                    value={toDate}
                    onChange={setToDate}
                    min={fromDate || localToday()}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lv-type">{t("leaveType")}</Label>
                <select
                  id="lv-type"
                  className="h-[42px] w-full rounded-md border border-input bg-white px-2.5 text-sm"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                >
                  {LEAVE_TYPES.map((lt) => (
                    <option key={lt} value={lt}>
                      {t(`leaveType_${lt}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lv-reason">{t("leaveReason")}</Label>
                <Textarea
                  id="lv-reason"
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("leaveReasonPlaceholder")}
                />
              </div>
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm transition-colors hover:bg-muted">
                {tc("cancel")}
              </DialogClose>
              <Button
                disabled={!fromDate || !toDate || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? tc("saving") : t("submitLeave")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {leaves.isLoading && <Skeleton className="h-16" />}
      {leaves.data && leaves.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noLeavesYet")}</p>
      )}
      <ul className="space-y-2">
        {(leaves.data?.items ?? []).map((leave) => (
          <li
            key={leave.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <span>
              <span className="font-medium">
                {fmtApiDate(leave.from_date)}
                {leave.to_date !== leave.from_date && ` – ${fmtApiDate(leave.to_date)}`}
              </span>{" "}
              <span className="text-muted-foreground">
                · {t(`leaveType_${leave.leave_type}`)}
              </span>
              {leave.decision_note && (
                <span className="block text-label text-muted-foreground">
                  {leave.decision_note}
                </span>
              )}
            </span>
            <StatusBadge tone={STATUS_TONE[leave.status]}>
              {t(`leaveStatus_${leave.status}`)}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}
