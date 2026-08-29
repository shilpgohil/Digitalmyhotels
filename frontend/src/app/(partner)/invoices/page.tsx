"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import type { InvoiceOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

function InvoicesContent() {
  const t = useTranslations("invoices");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const cancelConfirm = useConfirmDialog();

  const invoices = useQuery({
    queryKey: ["invoices", activeHotelId],
    queryFn: () => api<ListOut<InvoiceOut>>("/api/v1/invoices?limit=50"),
    enabled: !!activeHotelId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["invoices", activeHotelId] });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/v1/invoices/${id}/cancel`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      toast.success(t("cancelled"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const downloadPdf = async (id: string) => {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE}/api/v1/invoices/${id}/pdf`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "X-Hotel-Id": activeHotelId ?? "",
      },
      credentials: "include",
    });
    if (!res.ok) {
      toast.error(tc("error"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("money")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex justify-end">
          <GenerateDialog onDone={invalidate} />
        </div>
        <div className="rounded-lg border bg-card">
          {invoices.isLoading && <Skeleton className="h-48" />}
          {invoices.data?.items.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">{t("noInvoices")}</p>
          )}
          {invoices.data && invoices.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoiceNumber")}</TableHead>
                  <TableHead>{t("guest")}</TableHead>
                  <TableHead>{t("total")}</TableHead>
                  <TableHead>{t("due")}</TableHead>
                  <TableHead>{t("statusCol")}</TableHead>
                  <TableHead>{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.data.items.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>{inv.guest_name}</TableCell>
                    <TableCell className="tabular-nums">₹{inv.total_amount}</TableCell>
                    <TableCell className="tabular-nums">₹{inv.due_amount}</TableCell>
                    <TableCell>
                      <StatusBadge tone={inv.status === "cancelled" ? "danger" : "info"}>
                        {t(`status_${inv.status}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button variant="outline" size="sm" onClick={() => downloadPdf(inv.id)}>
                        {t("downloadPdf")}
                      </Button>
                      {inv.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCancelTarget(inv.id);
                            cancelConfirm.show();
                          }}
                        >
                          {t("cancelInvoice")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <ConfirmDialog
          open={cancelConfirm.open}
          title={t("cancelInvoice")}
          requireText
          textLabel={t("cancelReason")}
          textPlaceholder={t("cancelReason")}
          confirmLabel={t("cancelInvoice")}
          confirmVariant="destructive"
          isPending={cancelMutation.isPending}
          onConfirm={(reason) => {
            if (cancelTarget) {
              cancelMutation.mutate({ id: cancelTarget, reason });
              cancelConfirm.hide();
              setCancelTarget(null);
            }
          }}
          onCancel={() => {
            cancelConfirm.hide();
            setCancelTarget(null);
          }}
        />
      </main>
    </>
  );
}

function GenerateDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [interstate, setInterstate] = useState(false);

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId],
    queryFn: () => api<ListOut<BookingOut>>("/api/v1/bookings?limit=50"),
    enabled: open && !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: bookingId, interstate },
      }),
    onSuccess: () => {
      toast.success(t("generated"));
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">
        {t("generate")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("generate")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Booking</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border px-2.5 text-sm"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
            >
              <option value="">—</option>
              {bookings.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.booking_number}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={interstate}
              onChange={(e) => setInterstate(e.target.checked)}
            />
            {t("interstate")}
          </label>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button disabled={!bookingId || mutation.isPending} onClick={() => mutation.mutate()}>
            {t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoicesPage() {
  return (
    <RequirePermission permission={PERMISSIONS.invoicesManage}>
      <InvoicesContent />
    </RequirePermission>
  );
}
