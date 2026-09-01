"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, QrCode, Upload } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError, API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressLogo } from "@/lib/compress-image";
import { RequirePermission } from "@/components/auth/require-permission";
import { cn } from "@/lib/utils";
import type {
  GstSettingsOut,
  HotelOut,
  HotelSettingsOut,
  PaymentConfigOut,
} from "@/types/hotel";

type TabKey = "hotel" | "policies" | "gst" | "payments" | "services";

function SettingsContent() {
  const t = useTranslations("settings");
  const tn = useTranslations("nav");
  const { can } = useAuth();
  const router = useRouter();

  // Build the ordered list of available tabs for this user.
  const tabs: { key: TabKey; label: string }[] = [
    { key: "hotel", label: t("hotelTab") },
    { key: "policies", label: t("policiesTab") },
    ...(can(PERMISSIONS.gstManage) ? [{ key: "gst" as TabKey, label: t("gstTab") }] : []),
    ...(can(PERMISSIONS.hotelManageUpi) ? [{ key: "payments" as TabKey, label: t("paymentsTab") }] : []),
    ...(can(PERMISSIONS.hotelManageSettings) ? [{ key: "services" as TabKey, label: t("servicesTab") }] : []),
  ];

  // Persist the active tab in the URL hash so page refresh restores the tab.
  const [active, setActive] = useState<TabKey>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "") as TabKey;
      if (tabs.some((t) => t.key === hash)) return hash;
    }
    return tabs[0]?.key ?? "hotel";
  });

  const handleTabChange = useCallback(
    (key: TabKey) => {
      setActive(key);
      // Reflect the tab in the URL without adding a history entry.
      router.replace(`/settings#${key}`, { scroll: false });
    },
    [router],
  );

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Tab bar — custom implementation to avoid Base UI multi-panel rendering bug */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active === tab.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Link
            href="/change-password"
            className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
          >
            <KeyRound className="size-4" aria-hidden />
            {t("resetPassword")}
          </Link>
        </div>

        {/* Only the active panel is mounted — no phantom white boxes */}
        <div className="section-open mt-2">
          {active === "hotel" && <HotelProfileForm />}
          {active === "policies" && <PoliciesForm />}
          {active === "gst" && can(PERMISSIONS.gstManage) && <GstForm />}
          {active === "payments" && can(PERMISSIONS.hotelManageUpi) && <UpiConfigPanel />}
          {active === "services" && can(PERMISSIONS.hotelManageSettings) && <ServicesPanel />}
        </div>
      </main>
    </>
  );
}

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

function ServicesPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId, "all"],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services?include_inactive=true"),
    enabled: !!activeHotelId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["hotel-services", activeHotelId] });

  const create = useMutation({
    mutationFn: () =>
      api<ServiceItem>("/api/v1/hotels/me/services", {
        method: "POST",
        body: { name, price },
      }),
    onSuccess: () => {
      toast.success(t("serviceCreated"));
      setName("");
      setPrice("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const toggle = useMutation({
    mutationFn: (svc: ServiceItem) =>
      api<ServiceItem>(`/api/v1/hotels/me/services/${svc.id}`, {
        method: "PATCH",
        body: { is_active: !svc.is_active },
      }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("servicesHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>{t("serviceName")}</Label>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>{t("servicePrice")}</Label>
          <Input className="mt-1 w-32" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <Button
          disabled={name.length < 2 || !price || create.isPending}
          onClick={() => create.mutate()}
        >
          {t("addService")}
        </Button>
      </div>
      {services.isLoading && <Skeleton className="h-24" />}
      <ul className="space-y-2">
        {services.data?.map((svc) => (
          <li
            key={svc.id}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <span className={svc.is_active ? "" : "text-muted-foreground line-through"}>
              {svc.name} · ₹{svc.price}
            </span>
            <Button size="sm" variant="ghost" onClick={() => toggle.mutate(svc)}>
              {svc.is_active ? t("deactivateService") : t("activateService")}
            </Button>
          </li>
        ))}
      </ul>
      {services.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noServices")}</p>
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="max-w-2xl space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function useSaveToast() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  return {
    onSaved: () => toast.success(t("settingsSaved")),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  };
}

function HotelProfileForm() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const readOnly = !can(PERMISSIONS.hotelManageSettings);
  const { onSaved, onError } = useSaveToast();

  const hotel = useQuery({
    queryKey: ["hotel", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      return api<HotelOut>("/api/v1/hotels/me", {
        method: "PATCH",
        body: {
          name: fs("name").trim(),
          address_line1: fs("address_line1").trim() || null,
          city: fs("city").trim() || null,
          state: fs("state").trim() || null,
          postal_code: fs("postal_code").trim() || null,
          phone: fs("phone").trim() || null,
          email: fs("email").trim() || null,
          website: fs("website").trim() || null,
          description: fs("description").trim() || null,
        },
      });
    },
    onSuccess: () => {
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["hotel", activeHotelId] });
    },
    onError,
  });

  if (hotel.isLoading) return <FormSkeleton />;
  if (hotel.isError || !hotel.data) return <p className="text-sm text-danger">{tc("error")}</p>;
  const data = hotel.data;

  return (
    <form
      className="max-w-2xl space-y-4 rounded-lg border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(new FormData(e.currentTarget));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="h-name">{t("hotelName")}</Label>
          <Input id="h-name" name="name" defaultValue={data.name} required disabled={readOnly} />
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="h-addr">{t("address")}</Label>
          <Input id="h-addr" name="address_line1" defaultValue={data.address_line1 ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-city">{t("city")}</Label>
          <Input id="h-city" name="city" defaultValue={data.city ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-state">{t("state")}</Label>
          <Input id="h-state" name="state" defaultValue={data.state ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-pin">{t("postalCode")}</Label>
          <Input id="h-pin" name="postal_code" defaultValue={data.postal_code ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-phone">{t("phone")}</Label>
          <Input id="h-phone" name="phone" defaultValue={data.phone ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-email">{t("email")}</Label>
          <Input id="h-email" name="email" type="email" defaultValue={data.email ?? ""} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-web">{t("website")}</Label>
          <Input id="h-web" name="website" defaultValue={data.website ?? ""} disabled={readOnly} />
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="h-desc">{t("description")}</Label>
          <Textarea id="h-desc" name="description" defaultValue={data.description ?? ""} disabled={readOnly} rows={3} />
        </div>
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? tc("saving") : tc("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

function PoliciesForm() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const readOnly = !can(PERMISSIONS.hotelManageSettings);
  const { onSaved, onError } = useSaveToast();

  const settings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () => api<HotelSettingsOut>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      return api<HotelSettingsOut>("/api/v1/hotels/me/settings", {
        method: "PATCH",
        body: {
          check_in_time: fs("check_in_time"),
          check_out_time: fs("check_out_time"),
          invoice_prefix: fs("invoice_prefix").trim(),
          booking_prefix: fs("booking_prefix").trim(),
          tax_inclusive_pricing: form.get("tax_inclusive_pricing") === "on",
          cancellation_policy: fs("cancellation_policy").trim() || null,
          no_show_policy: fs("no_show_policy").trim() || null,
        },
      });
    },
    onSuccess: () => {
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["hotel-settings", activeHotelId] });
    },
    onError,
  });

  if (settings.isLoading) return <FormSkeleton />;
  if (settings.isError || !settings.data)
    return <p className="text-sm text-danger">{tc("error")}</p>;
  const data = settings.data;

  return (
    <form
      className="max-w-2xl space-y-4 rounded-lg border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(new FormData(e.currentTarget));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-cin">{t("checkinTime")}</Label>
          {/* type="time" renders a 24-hr picker on all major browsers */}
          <Input
            id="s-cin"
            name="check_in_time"
            type="time"
            step="1800"
            defaultValue={data.check_in_time.slice(0, 5)}
            disabled={readOnly}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-cout">{t("checkoutTime")}</Label>
          <Input
            id="s-cout"
            name="check_out_time"
            type="time"
            step="1800"
            defaultValue={data.check_out_time.slice(0, 5)}
            disabled={readOnly}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-inv">{t("invoicePrefix")}</Label>
          <Input id="s-inv" name="invoice_prefix" defaultValue={data.invoice_prefix} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-bk">{t("bookingPrefix")}</Label>
          <Input id="s-bk" name="booking_prefix" defaultValue={data.booking_prefix} disabled={readOnly} />
        </div>
        <div className="col-span-full flex items-center gap-2">
          <input
            id="s-taxinc"
            name="tax_inclusive_pricing"
            type="checkbox"
            defaultChecked={data.tax_inclusive_pricing}
            disabled={readOnly}
            className="size-4 rounded border-input"
          />
          <Label htmlFor="s-taxinc">{t("taxInclusive")}</Label>
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="s-cancel">{t("cancellationPolicy")}</Label>
          <Textarea id="s-cancel" name="cancellation_policy" defaultValue={data.cancellation_policy ?? ""} disabled={readOnly} rows={2} />
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="s-noshow">{t("noShowPolicy")}</Label>
          <Textarea id="s-noshow" name="no_show_policy" defaultValue={data.no_show_policy ?? ""} disabled={readOnly} rows={2} />
        </div>
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? tc("saving") : tc("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

function GstForm() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const { onSaved, onError } = useSaveToast();

  const gst = useQuery({
    queryKey: ["gst-settings", activeHotelId],
    queryFn: () => api<GstSettingsOut>("/api/v1/hotels/me/gst"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      return api<GstSettingsOut>("/api/v1/hotels/me/gst", {
        method: "PATCH",
        body: {
          is_gst_registered: form.get("is_gst_registered") === "on",
          gstin: fs("gstin").trim() || null,
          legal_name: fs("legal_name").trim() || null,
          trade_name: fs("trade_name").trim() || null,
          state: fs("state").trim() || null,
          state_code: fs("state_code").trim() || null,
          default_cgst_rate: fs("default_cgst_rate"),
          default_sgst_rate: fs("default_sgst_rate"),
          default_igst_rate: fs("default_igst_rate"),
        },
      });
    },
    onSuccess: () => {
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["gst-settings", activeHotelId] });
    },
    onError,
  });

  if (gst.isLoading) return <FormSkeleton />;
  if (gst.isError || !gst.data) return <p className="text-sm text-danger">{tc("error")}</p>;
  const data = gst.data;

  return (
    <form
      className="max-w-2xl space-y-4 rounded-lg border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(new FormData(e.currentTarget));
      }}
    >
      <div className="flex items-center gap-2">
        <input
          id="g-reg"
          name="is_gst_registered"
          type="checkbox"
          defaultChecked={data.is_gst_registered}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="g-reg">{t("gstRegistered")}</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="g-gstin">{t("gstin")}</Label>
          <Input id="g-gstin" name="gstin" defaultValue={data.gstin ?? ""} maxLength={15} placeholder="27ABCDE1234F1Z5" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-legal">{t("legalName")}</Label>
          <Input id="g-legal" name="legal_name" defaultValue={data.legal_name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-trade">{t("tradeName")}</Label>
          <Input id="g-trade" name="trade_name" defaultValue={data.trade_name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-state">{t("state")}</Label>
          <Input id="g-state" name="state" defaultValue={data.state ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-scode">{t("stateCode")}</Label>
          <Input id="g-scode" name="state_code" defaultValue={data.state_code ?? ""} maxLength={2} placeholder="27" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-cgst">{t("cgstRate")}</Label>
          <Input id="g-cgst" name="default_cgst_rate" type="number" step="0.01" min="0" max="50" defaultValue={data.default_cgst_rate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-sgst">{t("sgstRate")}</Label>
          <Input id="g-sgst" name="default_sgst_rate" type="number" step="0.01" min="0" max="50" defaultValue={data.default_sgst_rate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-igst">{t("igstRate")}</Label>
          <Input id="g-igst" name="default_igst_rate" type="number" step="0.01" min="0" max="100" defaultValue={data.default_igst_rate} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? tc("saving") : tc("save")}
        </Button>
      </div>
    </form>
  );
}

function UpiConfigPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();

  const config = useQuery({
    queryKey: ["payment-config", activeHotelId],
    queryFn: () => api<PaymentConfigOut>("/api/v1/hotels/me/payment-config"),
    enabled: !!activeHotelId,
  });

  // After saving, the QR regenerates in the background — poll for the new version.
  const pollForQr = async (fromVersion: number) => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await api<PaymentConfigOut>("/api/v1/hotels/me/payment-config");
      if (fresh.qr_version > fromVersion) {
        queryClient.setQueryData(["payment-config", activeHotelId], fresh);
        return;
      }
    }
    // QR took >6 s — just refetch once more to get whatever is available.
    queryClient.invalidateQueries({ queryKey: ["payment-config", activeHotelId] });
  };

  const upiMutation = useMutation({
    mutationFn: (upiId: string) =>
      api<PaymentConfigOut>("/api/v1/hotels/me/payment-config", {
        method: "PUT",
        body: { upi_id: upiId },
      }),
    onSuccess: (result) => {
      toast.success(t("upiSaved"));
      const prevVersion = data.qr_version;
      // Optimistically update config version in cache immediately.
      queryClient.setQueryData(["payment-config", activeHotelId], result);
      // Then wait for the QR to regenerate.
      void pollForQr(prevVersion);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-config/logo`, {
        method: "PUT",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new ApiError(
          resp.status,
          body?.error?.code ?? "upload_failed",
          body?.error?.message ?? "Upload failed",
        );
      }
      return resp.json() as Promise<PaymentConfigOut>;
    },
    onSuccess: (result) => {
      toast.success(t("logoUploaded"));
      const prevVersion = data.qr_version;
      queryClient.setQueryData(["payment-config", activeHotelId], result);
      void pollForQr(prevVersion);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  if (config.isLoading) return <FormSkeleton />;
  if (config.isError || !config.data)
    return <p className="text-sm text-danger">{tc("error")}</p>;
  const data = config.data;

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="space-y-4 rounded-lg border bg-card p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            upiMutation.mutate(((form.get("upi_id") as string | null) ?? "").trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="upi-id">{t("upiId")}</Label>
            <Input
              id="upi-id"
              name="upi_id"
              defaultValue={data.upi_id ?? ""}
              placeholder="hotelname@okhdfc"
              required
            />
            <p className="text-xs text-muted-foreground">{t("upiIdHint")}</p>
          </div>

          {/* Explain why UPI apps may show a personal name */}
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200">
            <strong>{t("upiNameNoteTitle")}</strong> {t("upiNameNote")}
          </div>

          <Button type="submit" disabled={upiMutation.isPending}>
            {upiMutation.isPending ? t("savingAndGeneratingQr") : tc("save")}
          </Button>
        </form>

        <div className="border-t pt-4">
          <Label htmlFor="logo-upload">{t("hotelLogo")}</Label>
          <p className="mb-2 text-xs text-muted-foreground">{t("logoHint")}</p>
          <label
            htmlFor="logo-upload"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-muted"
          >
            <Upload className="size-4" aria-hidden />
            {logoMutation.isPending ? tc("saving") : t("uploadLogo")}
          </label>
          <input
            id="logo-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={logoMutation.isPending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const compressed = await compressLogo(file);
                logoMutation.mutate(compressed);
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <QrPreview
        qrVersion={data.qr_version}
        updating={upiMutation.isPending || logoMutation.isPending}
      />
    </div>
  );
}

function QrPreview({ qrVersion, updating = false }: { readonly qrVersion: number; readonly updating?: boolean }) {
  const t = useTranslations("settings");
  const { activeHotelId } = useAuth();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    if (qrVersion < 1) return;
    (async () => {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image`, {
        headers,
        credentials: "include",
      });
      if (!resp.ok || cancelled) return;
      objectUrl = URL.createObjectURL(await resp.blob());
      if (!cancelled) setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [qrVersion, activeHotelId]);

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <QrCode className="size-4 text-gold-600" aria-hidden />
        {t("paymentQr")}
      </h3>
      {qrVersion < 1 && (
        <p className="text-center text-sm text-muted-foreground">{t("qrNotConfigured")}</p>
      )}
      {qrVersion >= 1 && !src && (
        <div className="relative size-56">
          <Skeleton className="size-56 rounded-md" />
          {updating && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80">
              <p className="text-xs font-medium text-muted-foreground animate-pulse">
                {t("generatingQr")}
              </p>
            </div>
          )}
        </div>
      )}
      {src && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="UPI payment QR"
            className={cn("size-56 rounded-md border transition-opacity duration-300", updating ? "opacity-40" : "opacity-100")}
          />
          {updating && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
              <p className="text-xs font-medium text-muted-foreground animate-pulse">
                {t("generatingQr")}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="mt-3 max-w-60 text-center text-xs text-muted-foreground">
        {t("regenerateHint")}
      </p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.hotelView}>
      <SettingsContent />
    </RequirePermission>
  );
}
