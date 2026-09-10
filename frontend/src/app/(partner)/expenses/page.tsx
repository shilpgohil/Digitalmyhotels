"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, CalendarRange, ListChecks, Paperclip, Plus, Wallet } from "lucide-react";
import { fmtApiDate, fmtINR, localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
// TableBody and TableRow used inside DataTable children
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressReceipt } from "@/lib/compress-image";
import { useImageEditor } from "@/components/media/image-editor";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type {
  ExpenseCategoryOut,
  ExpenseOut,
  ExpenseSummaryOut,
  RecurringExpenseOut,
} from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";

interface VendorOut {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  is_active: boolean;
}

/** Time-period chips above the stat cards (per Figma). */
const PERIODS = ["all", "today", "last5", "month", "year"] as const;
type Period = (typeof PERIODS)[number];

function ymd(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** From/to filter dates for a period chip, in the user's local timezone. */
function periodRange(period: Period): { from: string; to: string } {
  const today = localToday();
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "last5": {
      const d = new Date();
      d.setDate(d.getDate() - 4);
      return { from: ymd(d), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: "", to: "" };
  }
}

const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  paid: "success",
  rejected: "danger",
};

function ExpensesContent() {
  const t = useTranslations("expenses");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const rejectConfirm = useConfirmDialog();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  // Which time-period chip is active; null = manual dates entered.
  const [period, setPeriod] = useState<Period | null>("all");

  const selectPeriod = (p: Period) => {
    setPeriod(p);
    const { from, to } = periodRange(p);
    setFromDate(from);
    setToDate(to);
  };
  // Manual date edits deselect the chips.
  const setFromDateManual = (v: string) => {
    setFromDate(v);
    setPeriod(null);
  };
  const setToDateManual = (v: string) => {
    setToDate(v);
    setPeriod(null);
  };

  const filterQs = [
    fromDate && `from_date=${fromDate}`,
    toDate && `to_date=${toDate}`,
    filterCategoryId && `category_id=${filterCategoryId}`,
    filterMethod && `payment_method=${filterMethod}`,
  ]
    .filter(Boolean)
    .join("&");

  const categories = useQuery({
    queryKey: ["expense-categories", activeHotelId],
    queryFn: () => api<ExpenseCategoryOut[]>("/api/v1/expenses/categories"),
    enabled: !!activeHotelId && can(PERMISSIONS.expensesCreate),
  });

  const summary = useQuery({
    // Prefixed with ["expenses", hotelId] so invalidate() refreshes it too.
    queryKey: ["expenses", activeHotelId, "summary"],
    queryFn: () => api<ExpenseSummaryOut>("/api/v1/expenses/summary"),
    enabled: !!activeHotelId,
  });

  const expenses = useQuery({
    queryKey: ["expenses", activeHotelId, filterQs],
    queryFn: () =>
      api<ListOut<ExpenseOut>>(`/api/v1/expenses?limit=50${filterQs ? `&${filterQs}` : ""}`),
    enabled: !!activeHotelId,
  });
  const recurring = useQuery({
    queryKey: ["recurring", activeHotelId],
    queryFn: () => api<RecurringExpenseOut[]>("/api/v1/expenses/recurring"),
    enabled: !!activeHotelId,
  });

  // Vendors are loaded once and used both in the Add form and the table's
  // Vendor Name column (client 9-10 issue #10: vendor name missing from table).
  const allVendors = useQuery({
    queryKey: ["expense-vendors", activeHotelId],
    queryFn: () => api<VendorOut[]>("/api/v1/expenses/vendors"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
  const vendorById = (id: string | null | undefined) =>
    allVendors.data?.find((v) => v.id === id)?.name ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["recurring", activeHotelId] });
  };

  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) =>
      api(`/api/v1/expenses/${id}/${action}`, {
        method: "POST",
        body: reason ? { reason } : undefined,
      }),
    onSuccess: () => {
      toast.success(t("updated"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const runRecurring = useMutation({
    mutationFn: () => api<ListOut<ExpenseOut>>("/api/v1/expenses/recurring/run", { method: "POST" }),
    onSuccess: (data) => {
      toast.success(t("recurringGenerated", { count: data.total }));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("overview")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          {can(PERMISSIONS.expensesApprove) && (
            <>
              <AddVendorDialog onDone={invalidate} />
              <AddRecurringDialog onDone={invalidate} />
              <Button variant="outline" onClick={() => runRecurring.mutate()}>
                {t("runRecurring")}
              </Button>
            </>
          )}
        </div>

        {/* Time-period chips (per Figma) — set the from/to filter dates */}
        <div className="mb-4 inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                period === p
                  ? "bg-navy-900 text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => selectPeriod(p)}
            >
              {t(`period_${p}`)}
            </button>
          ))}
        </div>

        {/* Stat cards */}
        <StatCardGrid className="mb-4">
          <StatCard
            label={t("statTotal")}
            value={fmtINR(summary.data?.total_amount ?? 0)}
            subtitle="Approved + Paid"
            icon={Wallet}
            tone="navy"
            isLoading={summary.isLoading}
          />
          <StatCard
            label={t("statPending")}
            value={fmtINR(summary.data?.pending_amount ?? 0)}
            subtitle="Awaiting Approval"
            icon={CalendarDays}
            tone="amber"
            isLoading={summary.isLoading}
          />
          <StatCard
            label={t("statMonth")}
            value={fmtINR(summary.data?.month_amount ?? 0)}
            subtitle="This Month"
            icon={CalendarRange}
            tone="gold"
            isLoading={summary.isLoading}
          />
          <StatCard
            label={t("statEntries")}
            value={String(summary.data?.entries ?? 0)}
            subtitle="All Entries"
            icon={ListChecks}
            tone="navy2"
            isLoading={summary.isLoading}
          />
        </StatCardGrid>

        {/* Inline add-expense card (replaces the old dialog, per Figma) */}
        {can(PERMISSIONS.expensesCreate) && <InlineAddExpense onDone={invalidate} />}

        {/* Ledger filters */}
        <FilterBar
          className="mb-4"
          fromDate={fromDate}
          onFromDateChange={setFromDateManual}
          fromLabel={t("fromDate")}
          toDate={toDate}
          onToDateChange={setToDateManual}
          toLabel={t("toDate")}
          selectValue={filterCategoryId}
          onSelectChange={setFilterCategoryId}
          selectOptions={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          selectPlaceholder={t("allCategories")}
          selectLabel={t("category")}
          select2Value={filterMethod}
          onSelect2Change={setFilterMethod}
          select2Options={FILTER_MODES.map((m) => ({ value: m, label: t(`mode_${m}`) }))}
          select2Placeholder={t("allMethods")}
          select2Label={t("paymentMode")}
          hasActiveFilters={!!(fromDate || toDate || filterCategoryId || filterMethod)}
          onClear={() => {
            setFromDate("");
            setToDate("");
            setFilterCategoryId("");
            setFilterMethod("");
            setPeriod("all");
          }}
        />

        <DataTable
          darkHeader
          tableClassName="min-w-[700px]"
          isLoading={expenses.isLoading}
          isError={expenses.isError}
          onRetry={() => expenses.refetch()}
          isEmpty={expenses.data?.items.length === 0}
          emptyTitle={t("noExpenses")}
          columns={[
            t("expenseDate"),
            t("amount"),
            t("description"),
            t("vendorName"),
            t("paymentMode"),
            t("statusCol"),
            tc("actions"),
          ]}
        >
          {expenses.data?.items.map((ex) => (
            <TableRow key={ex.id}>
              <TableCell>{fmtApiDate(ex.expense_date)}</TableCell>
              <TableCell className="tabular-nums">{fmtINR(ex.amount)}</TableCell>
              <TableCell>{ex.description ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {vendorById(ex.vendor_id) ?? "—"}
              </TableCell>
              <TableCell>
                {FILTER_MODES.includes(ex.payment_method)
                  ? t(`mode_${ex.payment_method}`)
                  : ex.payment_method}
              </TableCell>
              <TableCell>
                <StatusBadge tone={TONE[ex.status] ?? "neutral"}>
                  {t(`status_${ex.status}`)}
                </StatusBadge>
              </TableCell>
              <TableCell className="space-x-1">
                {ex.has_attachment && <ViewReceiptButton expenseId={ex.id} />}
                {ex.status === "draft" && can(PERMISSIONS.expensesCreate) && (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: ex.id, action: "submit" })}>
                    {t("submit")}
                  </Button>
                )}
                {ex.status === "submitted" && can(PERMISSIONS.expensesApprove) && (
                  <>
                    <Button size="sm" onClick={() => act.mutate({ id: ex.id, action: "approve" })}>
                      {t("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRejectTarget(ex.id);
                        rejectConfirm.show();
                      }}
                    >
                      {t("reject")}
                    </Button>
                  </>
                )}
                {ex.status === "approved" && can(PERMISSIONS.expensesApprove) && (
                  <Button size="sm" onClick={() => act.mutate({ id: ex.id, action: "mark-paid" })}>
                    {t("markPaid")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {recurring.data && recurring.data.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("recurring")}: {recurring.data.map((r) => r.name).join(", ")}
          </p>
        )}

        <ConfirmDialog
          open={rejectConfirm.open}
          title={t("reject")}
          requireText
          textLabel={t("rejectReason")}
          textPlaceholder={t("rejectReason")}
          confirmLabel={t("reject")}
          confirmVariant="destructive"
          isPending={act.isPending}
          onConfirm={(reason) => {
            if (rejectTarget) {
              act.mutate({ id: rejectTarget, action: "reject", reason });
              rejectConfirm.hide();
              setRejectTarget(null);
            }
          }}
          onCancel={() => {
            rejectConfirm.hide();
            setRejectTarget(null);
          }}
        />
      </main>
    </>
  );
}

function AddVendorDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api<VendorOut>("/api/v1/expenses/vendors", {
        method: "POST",
        body: { name, phone: phone || null, gstin: gstin || null },
      }),
    onSuccess: () => {
      toast.success(t("vendorCreated"));
      setOpen(false);
      setName("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
        {t("addVendor")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addVendor")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("vendorName")}</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t("vendorPhone")}</Label>
            <Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>GSTIN</Label>
            <Input className="mt-1" value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button disabled={name.length < 2 || mutation.isPending} onClick={() => mutation.mutate()}>
            {t("addVendor")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRecurringDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [startDate, setStartDate] = useState(localToday);
  const [categoryId, setCategoryId] = useState("");

  const categories = useQuery({
    queryKey: ["expense-categories", activeHotelId],
    queryFn: () => api<ExpenseCategoryOut[]>("/api/v1/expenses/categories"),
    enabled: open && !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api<RecurringExpenseOut>("/api/v1/expenses/recurring", {
        method: "POST",
        body: {
          name,
          amount,
          frequency,
          start_date: startDate,
          category_id: categoryId || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("recurringCreated"));
      setOpen(false);
      setName("");
      setAmount("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
        {t("addRecurring")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addRecurring")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("name")}</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("amount")}</Label>
              <Input className="mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>{t("frequency")}</Label>
              <select
                className="mt-1 h-8 w-full rounded-lg border px-2.5 text-sm"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                {["monthly", "quarterly", "yearly"].map((f) => (
                  <option key={f} value={f}>
                    {t(`freq_${f}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("startDate")}</Label>
              <DatePicker
                className="mt-1"
                value={startDate}
                onChange={setStartDate}
              />
            </div>
            <div>
              <Label>{t("category")}</Label>
              <select
                className="mt-1 h-8 w-full rounded-lg border px-2.5 text-sm"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t("selectCategory")}</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button
            disabled={name.length < 2 || !amount || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("addRecurring")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Modes offered when RECORDING an expense (client 9-08 item 14 set). */
const PAYMENT_MODES = ["cash", "upi", "credit_card", "debit_card", "bank_transfer"] as const;

/** Ledger filter modes — includes legacy "card" so old rows stay findable. */
const FILTER_MODES: string[] = [...PAYMENT_MODES, "card", "other"];

/** Fetches the receipt with auth headers and opens it in a new tab. */
function ViewReceiptButton({ expenseId }: { expenseId: string }) {
  const t = useTranslations("expenses");
  const { activeHotelId } = useAuth();
  const [loading, setLoading] = useState(false);

  const openReceipt = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const res = await fetch(`${API_BASE}/api/v1/expenses/${expenseId}/attachment`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
      // Give the new tab time to load the blob before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(t("receiptOpenFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={loading}
      onClick={openReceipt}
      aria-label={t("viewReceipt")}
      title={t("viewReceipt")}
    >
      <Paperclip className="size-3.5" aria-hidden />
    </Button>
  );
}

function InlineAddExpense({ onDone }: { onDone: () => void }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const { edit } = useImageEditor();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(localToday);
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [vendorId, setVendorId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories = useQuery({
    queryKey: ["expense-categories", activeHotelId],
    queryFn: () => api<ExpenseCategoryOut[]>("/api/v1/expenses/categories"),
    enabled: !!activeHotelId,
  });

  const vendors = useQuery({
    queryKey: ["expense-vendors", activeHotelId],
    queryFn: () => api<VendorOut[]>("/api/v1/expenses/vendors"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const expense = await api<{ id: string }>("/api/v1/expenses", {
        method: "POST",
        body: {
          amount,
          description: description || null,
          expense_date: expenseDate,
          category_id: categoryId || null,
          vendor_id: vendorId || null,
          payment_method: paymentMethod,
          submit: true,
        },
      });
      // The expense is created either way — a failed upload must not undo it,
      // so surface upload errors as a separate toast instead of failing the mutation.
      if (receiptFile) {
        try {
          const upload =
            receiptFile.type === "application/pdf"
              ? receiptFile
              : await compressReceipt(receiptFile);
          const form = new FormData();
          form.append("file", upload);
          await apiUpload(`/api/v1/expenses/${expense.id}/attachment`, form, {
            method: "PUT",
            hotelId: activeHotelId ?? undefined,
          });
        } catch (err) {
          // Keep the "expense saved" context AND the API's specific reason.
          toast.error(
            err instanceof ApiError
              ? `${t("receiptUploadFailed")} — ${err.message}`
              : t("receiptUploadFailed"),
          );
        }
      }
      return expense;
    },
    onSuccess: () => {
      toast.success(t("created"));
      setAmount("");
      setDescription("");
      setExpenseDate(localToday());
      setCategoryId("");
      setPaymentMethod("cash");
      setVendorId("");
      setReceiptFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <section className="mb-4 rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{t("addExpense")}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div>
          <Label>{t("expenseDate")}</Label>
          <DatePicker className="mt-1" value={expenseDate} onChange={setExpenseDate} />
        </div>
        <div>
          <Label>{t("category")}</Label>
          <select
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("selectCategory")}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t("description")}</Label>
          <Input
            className="mt-1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("amount")}</Label>
          <Input
            className="mt-1"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("paymentMode")}</Label>
          <select
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {PAYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`mode_${mode}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t("paidTo")}</Label>
          <select
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            <option value="">{t("selectVendor")}</option>
            {vendors.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="exp-receipt">{t("receiptOptional")}</Label>
          <input
            id="exp-receipt"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="mt-1 block w-full text-sm text-muted-foreground file:mr-2 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:text-foreground"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              // PDFs bypass client-side compression, so enforce the backend's
              // 5 MB attachment cap here for an immediate, clear error instead
              // of a failed upload after the expense is already created.
              if (f && f.type === "application/pdf" && f.size > 5 * 1024 * 1024) {
                toast.error(t("receiptTooLarge"));
                setReceiptFile(null);
                return;
              }
              if (f && f.type.startsWith("image/")) {
                // "free" aspect — receipts come in all orientations; cropping to
                // a fixed ratio cuts the bottom of portrait or top of landscape
                // bills (client 9-10 issue #9: bill image cut when viewing).
                void edit(f, { aspect: "free", maxDimension: 1400 }).then((framed) => {
                  if (framed) setReceiptFile(framed);
                });
                return;
              }
              setReceiptFile(f);
            }}
          />
          {/* Show selected file name so staff confirm the right file was picked
              (client 9-10 issue #10: file name not displayed after upload). */}
          {receiptFile && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate max-w-xs">{receiptFile.name}</span>
              <button
                type="button"
                className="text-danger hover:opacity-70 ml-1"
                onClick={() => setReceiptFile(null)}
                aria-label="Remove file"
              >×</button>
            </p>
          )}
        </div>
      </div>
      <Button
        className="mt-4 w-full bg-gold-500 text-navy-900 hover:bg-gold-400"
        disabled={!amount || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Plus className="size-4" aria-hidden />
        {mutation.isPending ? tc("saving") : t("addExpense")}
      </Button>
    </section>
  );
}

export default function ExpensesPage() {
  return (
    <RequirePermission permission={PERMISSIONS.expensesView}>
      <ExpensesContent />
    </RequirePermission>
  );
}
