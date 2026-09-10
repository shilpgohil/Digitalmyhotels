"use client";

/**
 * Super Admin — Password Reset Requests (client 9-08 item 34).
 *
 * Hotel owners/administrators who forget their password land here: the
 * super admin issues a temporary password (sessions revoked, change forced
 * at next login, audited) or dismisses the request.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionPanel } from "@/components/ui/section-panel";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/formatting";

interface ResetRequestRow {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  hotel_id: string | null;
  hotel_name: string | null;
  requested_at: string;
}

export default function AdminPasswordRequestsPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const requests = useQuery({
    queryKey: ["admin-password-requests"],
    queryFn: () =>
      apiFetch<ResetRequestRow[]>("/api/v1/super-admin/password-requests"),
    refetchInterval: 60_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-password-requests"] });

  const resetMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiFetch(`/api/v1/super-admin/users/${userId}/reset-password`, {
        method: "POST",
        body: { new_password: password },
      }),
    onSuccess: () => {
      toast.success(t("passwordResetIssued"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const dismissMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiFetch(`/api/v1/super-admin/password-requests/${requestId}/dismiss`, {
        method: "POST",
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <main className="space-y-6 p-6">
      <div>
        <p className="text-micro font-semibold uppercase tracking-widest text-gold-600">
          {t("portal")}
        </p>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("passwordRequestsNav")}</h1>
      </div>
        <SectionPanel
          title={t("passwordRequestsTitle")}
          icon={KeyRound}
          subtitle={t("passwordRequestsHint")}
          noPadding
        >
          {requests.isLoading && (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}
          {requests.isError && (
            <p className="p-8 text-center text-sm text-danger">
              {requests.error instanceof ApiError ? requests.error.message : tc("error")}{" "}
              <button type="button" className="underline" onClick={() => requests.refetch()}>{tc("retry")}</button>
            </p>
          )}
          {requests.data && requests.data.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">{t("noPasswordRequests")}</p>
          )}
          {requests.data && requests.data.length > 0 && (
            <ul className="divide-y">
              {requests.data.map((req) => (
                <li key={req.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">{req.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {req.email}{req.hotel_name ? ` · ${req.hotel_name}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(req.requested_at)}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-48">
                      <PasswordInput
                        placeholder={t("tempPasswordPlaceholder")}
                        value={passwords[req.id] ?? ""}
                        onChange={(e) => setPasswords((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        minLength={8}
                      />
                    </div>
                    <Button size="sm" disabled={(passwords[req.id] ?? "").length < 8 || resetMutation.isPending}
                      onClick={() => resetMutation.mutate({ userId: req.user_id, password: passwords[req.id] })}>
                      {t("issueReset")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={dismissMutation.isPending}
                      onClick={() => dismissMutation.mutate(req.id)}>
                      {t("dismissRequestAdmin")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>
    </main>
  );
}


