"use client";

/**
 * Super Admin — All Customers (client 9-08 item 36).
 *
 * Cross-hotel guest directory: search shows MASKED, tenant-labelled rows;
 * the full profile only loads through the explicit View action, which the
 * backend writes to the audit log on every call.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";

interface CustomerSummary {
  guest_id: string;
  full_name: string;
  phone_masked: string;
  hotel_id: string;
  hotel_name: string;
  city: string | null;
  id_proof_type: string | null;
  id_last4: string | null;
  created_at: string;
}

interface CustomerDetail extends Omit<CustomerSummary, "phone_masked"> {
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  gender: string | null;
  date_of_birth: string | null;
}

const PAGE_SIZE = 20;

export default function AdminCustomersPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<CustomerSummary | null>(null);

  const customers = useQuery({
    queryKey: ["admin-customers", search, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      return apiFetch<{ items: CustomerSummary[]; total: number }>(
        `/api/v1/super-admin/customers?${params}`,
      );
    },
    staleTime: 30_000,
  });

  const total = customers.data?.total ?? 0;

  const cols = [t("customerName"), t("contactNumber"), t("hotelName"), t("city"), "ID", tc("actions")];

  /** Export the FULL (unpaginated) filtered list as CSV — masked fields only,
   *  same privacy level as the on-screen table (client 09/2026). */
  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    params.set("limit", "5000");
    params.set("offset", "0");
    const data = await apiFetch<{ items: CustomerSummary[] }>(
      `/api/v1/super-admin/customers?${params}`,
    );
    const esc = (v: string | null | undefined) =>
      `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["Customer", "Contact (masked)", "Hotel", "City"].join(","),
      ...data.items.map((c) =>
        [esc(c.full_name), esc(c.phone_masked), esc(c.hotel_name), esc(c.city)].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "all-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-micro font-semibold uppercase tracking-widest text-gold-600">
          {t("portal")}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{t("allCustomersSection")}</h1>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(0); }}
          searchPlaceholder={t("searchCustomers")}
        />
        <button
          type="button"
          onClick={() => void exportCsv()}
          className="inline-flex h-[42px] items-center gap-1.5 rounded-md border border-input bg-white px-3.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <Download className="size-4" aria-hidden />
          {t("exportCsv")}
        </button>
      </div>

      <DataTable
        darkHeader
        isLoading={customers.isLoading}
        isError={customers.isError}
        errorMessage={customers.error instanceof ApiError ? customers.error.message : tc("error")}
        onRetry={() => customers.refetch()}
        isEmpty={customers.data?.items.length === 0}
        emptyTitle={t("noCustomers")}
        columns={cols}
      >
        {customers.data?.items.map((c) => (
          <tr key={c.guest_id} className="border-t hover:bg-muted/20">
            <td className="px-4 py-3 font-medium">{c.full_name}</td>
            <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.phone_masked || "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{c.hotel_name}</td>
            <td className="px-4 py-3 text-muted-foreground">{c.city ?? "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{c.id_last4 ? `••${c.id_last4}` : "—"}</td>
            <td className="px-4 py-3">
              <button type="button" onClick={() => setViewing(c)}
                className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold hover:bg-muted"
                title={t("viewCustomerHint")}>
                <Eye className="size-3" aria-hidden />
                {t("viewCustomer")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-5 py-3 text-sm">
          <span className="text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border px-3 py-1 disabled:opacity-40">‹</button>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border px-3 py-1 disabled:opacity-40">›</button>
          </div>
        </div>
      )}

      <CustomerDetailDialog
        customer={viewing}
        onClose={() => setViewing(null)}
      />
    </main>
  );
}

function CustomerDetailDialog({
  customer,
  onClose,
}: {
  readonly customer: CustomerSummary | null;
  readonly onClose: () => void;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");

  // The audited fetch only fires when the dialog opens (explicit View).
  const detail = useQuery({
    queryKey: ["admin-customer-detail", customer?.guest_id],
    queryFn: () =>
      apiFetch<CustomerDetail>(`/api/v1/super-admin/customers/${customer!.guest_id}`),
    enabled: !!customer,
    staleTime: 0,
    gcTime: 0,
  });
  const d = detail.data;

  return (
    <Dialog open={customer !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer?.full_name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("auditedViewNote")}</p>
        {detail.isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {detail.isError && (
          <p className="text-sm text-danger">
            {detail.error instanceof ApiError ? detail.error.message : tc("error")}
          </p>
        )}
        {d && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {(
              [
                [t("hotelName"), d.hotel_name],
                [t("contactNumber"), d.phone],
                ["Email", d.email],
                [t("city"), d.city],
                ["State", d.state],
                ["PIN", d.postal_code],
                ["Address", d.address],
                ["Gender", d.gender],
                ["DOB", d.date_of_birth ? fmtApiDate(d.date_of_birth) : null],
                ["ID", d.id_proof_type ? `${d.id_proof_type} ••${d.id_last4 ?? ""}` : null],
                [t("createdAtLabel"), fmtApiDate(d.created_at)],
              ] as Array<[string, string | null]>
            ).map(([label, value]) => (
              <div key={label} className={label === "Address" ? "col-span-2" : ""}>
                <dt className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-0.5 font-medium">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm hover:bg-muted">
            {tc("close")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

