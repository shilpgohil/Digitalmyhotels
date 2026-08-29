"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { fmtDate, fmtDateTime } from "@/lib/formatting";
import { CheckoutDialog } from "@/components/stay/checkout-dialog";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import type { ListOut } from "@/types/hotel";
import type { CurrentGuestOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

function CheckoutContent() {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const [target, setTarget] = useState<CurrentGuestOut | null>(null);

  const guests = useQuery({
    queryKey: ["current-guests", activeHotelId, "for-checkout"],
    queryFn: () => api<ListOut<CurrentGuestOut>>("/api/v1/current-guests?limit=100"),
    enabled: !!activeHotelId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  return (
    <>
      <PartnerHeader title={t("checkoutTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground">{t("inHouse")}</h2>
        <div className="rounded-lg border bg-card">
          {guests.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {guests.isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => guests.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {guests.data && guests.data.items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noCheckoutReady")}
            </p>
          )}
          {guests.data && guests.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{tb("bookingNumber")}</TableHead>
                  <TableHead className="text-white">{tb("guest")}</TableHead>
                  <TableHead className="text-white">{tb("roomsCol")}</TableHead>
                  <TableHead className="text-white">{t("expectedCheckout")}</TableHead>
                  <TableHead className="text-white">{tb("payment")}</TableHead>
                  <TableHead className="text-white">{tb("due")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guests.data.items.map((entry) => (
                  <TableRow key={entry.booking_id}>
                    <TableCell className="font-medium">{entry.booking_number}</TableCell>
                    <TableCell>{entry.primary_guest_name}</TableCell>
                    <TableCell>{entry.rooms.join(", ")}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      {entry.expected_checkout_at
                        ? fmtDateTime(entry.expected_checkout_at)
                        : fmtDate(entry.check_out_date)}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={entry.payment_status} />
                    </TableCell>
                    <TableCell className="tabular-nums">₹{entry.due_amount}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="destructive" onClick={() => setTarget(entry)}>
                        <LogOut className="size-4" aria-hidden />
                        {t("checkOutAction")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <CheckoutDialog entry={target} onClose={() => setTarget(null)} onDone={invalidate} />
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <RequirePermission permission={PERMISSIONS.checkout}>
      <CheckoutContent />
    </RequirePermission>
  );
}
