"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import { fmtDateTimeFull } from "@/lib/formatting";

interface AuditLogOut {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  correlation_id: string | null;
  created_at: string;
}

interface AuditList {
  items: AuditLogOut[];
  total: number;
}

function AuditContent() {
  const t = useTranslations("audit");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const [action, setAction] = useState("");

  const logs = useQuery({
    queryKey: ["audit", activeHotelId, action],
    queryFn: () =>
      api<AuditList>(
        `/api/v1/audit-logs?limit=100${action ? `&action=${encodeURIComponent(action)}` : ""}`,
      ),
    enabled: !!activeHotelId && can(PERMISSIONS.auditView),
  });

  if (!can(PERMISSIONS.auditView)) {
    return (
      <>
        <PartnerHeader title={t("title")} subtitle={tn("operations")} />
        <main className="flex-1 p-6">
          <p className="text-sm text-muted-foreground">{tc("unauthorized")}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <Input
            placeholder={t("filterByAction")}
            className="max-w-xs"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </div>
        <div className="rounded-lg border bg-card">
          {logs.isLoading && <Skeleton className="h-48" />}
          {logs.isError && (
            <p className="p-4 text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => logs.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {logs.data?.items.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
          )}
          {logs.data && logs.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("when")}</TableHead>
                  <TableHead>{t("action")}</TableHead>
                  <TableHead>{t("entity")}</TableHead>
                  <TableHead>{t("entityId")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTimeFull(log.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell>{log.entity_type}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.entity_id ? `${log.entity_id.slice(0, 8)}…` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission permission={PERMISSIONS.auditView}>
      <AuditContent />
    </RequirePermission>
  );
}
