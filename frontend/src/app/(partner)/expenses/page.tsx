"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fmtApiDate, fmtINR, localToday } from "@/lib/formatting";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
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
import { ApiError } from "@/lib/api/client";
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

  const expenses = useQuery({
    queryKey: ["expenses", activeHotelId],
    queryFn: () => api<ListOut<ExpenseOut>>("/api/v1/expenses?limit=50"),
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
                      <StatusBadge tone={TONE[ex.status] ?? "neutral"}>
                        {t(`status_${ex.status}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="space-x-1">
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
              <DateInput
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
    mutationFn: () =>
      api<{ id: string }>("/api/v1/expenses", {
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
      }),
    onSuccess: () => {
      toast.success(t("created"));
      setAmount("");
      setDescription("");
      setExpenseDate(localToday());
      setCategoryId("");
      setPaymentMethod("cash");
      setVendorId("");
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
          <DateInput className="mt-1" value={expenseDate} onChange={setExpenseDate} />
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
