"use client";

/** /staff/leaves — leave request approvals (owner/manager decide). */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarX2, Check, X } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtApiDate } from "@/lib/formatting";
import type { LeaveListOut, LeaveOut } from "@/types/staff";

const STATUS_TONE: Record<LeaveOut["status"], "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

function LeavesContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<string>("pending");
  const [rejectTarget, setRejectTarget] = useState<LeaveOut | null>(null);
  const rejectConfirm = useConfirmDialog();
  const canDecide = can(PERMISSIONS.staffAttendanceCorrect);

  const leaves = useQuery({
    queryKey: ["staff-leaves", activeHotelId, status],
    queryFn: () =>
      api<LeaveListOut>(
        `/api/v1/staff/leaves?limit=100${status !== "all" ? `&status=${status}` : ""}`,
      ),
    enabled: !!activeHotelId,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: "approve" | "reject";
      note?: string;
    }) =>
      api<LeaveOut>(`/api/v1/staff/leaves/${id}/decide`, {
        method: "POST",
        body: { action, note: note || null },
      }),
    onSuccess: (_, vars) => {
      toast.success(
        vars.action === "approve" ? t("leaveApprovedToast") : t("leaveRejectedToast"),
      );
      queryClient.invalidateQueries({ queryKey: ["staff-leaves", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["staff-attendance", activeHotelId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("leavesTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4">
          <SegmentedChips
            options={[
              { value: "pending", label: t("leaveStatus_pending") },
              { value: "approved", label: t("leaveStatus_approved") },
              { value: "rejected", label: t("leaveStatus_rejected") },
              { value: "all", label: t("statusAll") },
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>

        <DataTable
          darkHeader
          isLoading={leaves.isLoading}
          isError={leaves.isError}
          onRetry={() => leaves.refetch()}
          isEmpty={leaves.data?.items.length === 0}
          emptyTitle={t("noLeaveRequests")}
          emptySubtitle={t("noLeaveRequestsSubtitle")}
          columns={[
            t("staffMember"),
            t("leaveDates"),
            t("leaveType"),
            t("leaveReason"),
            t("statusCol"),
            tc("actions"),
          ]}
        >
          {(leaves.data?.items ?? []).map((leave) => (
            <TableRow key={leave.id}>
              <TableCell>
                <span className="block font-medium">{leave.full_name ?? "—"}</span>
                <span className="block text-label text-muted-foreground">
                  {leave.staff_code}
                  {leave.department ? ` · ${t(`dept_${leave.department}`)}` : ""}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">
                {fmtApiDate(leave.from_date)}
                {leave.to_date !== leave.from_date && ` – ${fmtApiDate(leave.to_date)}`}
              </TableCell>
              <TableCell>{t(`leaveType_${leave.leave_type}`)}</TableCell>
              <TableCell className="max-w-64 truncate" title={leave.reason ?? undefined}>
                {leave.reason ?? "—"}
              </TableCell>
              <TableCell>
                <StatusBadge tone={STATUS_TONE[leave.status]}>
                  {t(`leaveStatus_${leave.status}`)}
                </StatusBadge>
                {leave.decision_note && (
                  <span className="block text-label text-muted-foreground">
                    {leave.decision_note}
                  </span>
                )}
              </TableCell>
              <TableCell className="space-x-2 whitespace-nowrap">
                {leave.status === "pending" && canDecide && (
                  <>
                    <Button
                      size="sm"
                      className="bg-success text-white hover:bg-success/90"
                      disabled={decideMutation.isPending}
                      onClick={() =>
                        decideMutation.mutate({ id: leave.id, action: "approve" })
                      }
                    >
                      <Check className="mr-1 size-3.5" aria-hidden />
                      {t("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-danger hover:text-danger"
                      disabled={decideMutation.isPending}
                      onClick={() => {
                        setRejectTarget(leave);
                        rejectConfirm.show();
                      }}
                    >
                      <X className="mr-1 size-3.5" aria-hidden />
                      {t("reject")}
                    </Button>
                  </>
                )}
                {leave.status !== "pending" && "—"}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>

        <ConfirmDialog
          open={rejectConfirm.open}
          title={t("rejectLeaveTitle")}
          message={
            rejectTarget
              ? `${rejectTarget.full_name ?? ""} — ${fmtApiDate(rejectTarget.from_date)}`
              : undefined
          }
          requireText
          textLabel={t("rejectReasonLabel")}
          textPlaceholder={t("rejectReasonLabel")}
          confirmLabel={t("reject")}
          confirmVariant="destructive"
          isPending={decideMutation.isPending}
          onConfirm={(note) => {
            if (rejectTarget) {
              decideMutation.mutate({ id: rejectTarget.id, action: "reject", note });
              rejectConfirm.hide();
              setRejectTarget(null);
            }
          }}
          onCancel={() => {
            rejectConfirm.hide();
            setRejectTarget(null);
          }}
        />
        <span className="sr-only">
          <CalendarX2 aria-hidden />
        </span>
      </main>
    </>
  );
}

export default function StaffLeavesPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceView}>
      <LeavesContent />
    </RequirePermission>
  );
}
