"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Plus } from "lucide-react";
import { fmtApiDate, fmtINR, localToday } from "@/lib/formatting";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
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
import { API_BASE, ApiError, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressReceipt } from "@/lib/compress-image";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type { ExpenseCategoryOut, ExpenseOut, RecurringExpenseOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";

interface VendorOut {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  is_active: boolean;
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
      <main className="flex-1 overflow-y-auto p-6">
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

        {/* Inline add-expense card (replaces the old dialog, per Figma) */}
        {can(PERMISSIONS.expensesCreate) && <InlineAddExpense onDone={invalidate} />}

        {/* Ledger filters */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>{t("fromDate")}</Label>
            <DatePicker className="mt-1" value={fromDate} onChange={setFromDate} />
          </div>
          <div>
            <Label>{t("toDate")}</Label>
            <DatePicker className="mt-1" value={toDate} onChange={setToDate} />
          </div>
          {(categories.data?.length ?? 0) > 0 && (
            <div className="min-w-40">
              <Label>{t("category")}</Label>
              <select
                className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
              >
                <option value="">{t("allCategories")}</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-40">
            <Label>{t("paymentMode")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
            >
              <option value="">{t("allMethods")}</option>
              {FILTER_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`mode_${mode}`)}
                </option>
              ))}
            </select>
          </div>
          {(fromDate || toDate || filterCategoryId || filterMethod) && (
            <Button
              variant="outline"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setFilterCategoryId("");
                setFilterMethod("");
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
        </div>

        <div className="rounded-lg border bg-card">
          {expenses.isLoading && <Skeleton className="h-48" />}
          {expenses.isError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {tc("error")}
            </p>
          )}
          {expenses.data?.items.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">{t("noExpenses")}</p>
          )}
          {expenses.data && expenses.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("expenseDate")}</TableHead>
                  <TableHead>{t("amount")}</TableHead>
                  <TableHead>{t("description")}</TableHead>
                  <TableHead>{t("paymentMode")}</TableHead>
                  <TableHead>{t("statusCol")}</TableHead>
                  <TableHead>{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.data.items.map((ex) => (
                  <TableRow key={ex.id}>
                    <TableCell>{fmtApiDate(ex.expense_date)}</TableCell>
                    <TableCell className="tabular-nums">{fmtINR(ex.amount)}</TableCell>
                    <TableCell>{ex.description ?? "—"}</TableCell>
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
              </TableBody>
            </Table>
          )}
        </div>
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
                <option value="">—</option>
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

const PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer"] as const;

/** Modes offered by the ledger filter (superset incl. "other" used by the API). */
const FILTER_MODES: string[] = [...PAYMENT_MODES, "other"];

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
          toast.error(err instanceof ApiError ? err.message : t("receiptUploadFailed"));
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
            <option value="">—</option>
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
            <option value="">—</option>
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
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
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
