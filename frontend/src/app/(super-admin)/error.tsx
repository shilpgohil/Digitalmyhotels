"use client";

/**
 * Route-level error boundary for the Super Admin console (client 9-08 item 37
 * — a client-side exception previously white-screened the whole console).
 * Next.js renders this in place of the failing segment; the sidebar/layout
 * keep working and the user can retry or navigate away.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("admin");

  useEffect(() => {
    // Surface the real error for diagnosis (item 37 asked us to reproduce
    // and eliminate the crash — this keeps the evidence visible).
    console.error("[super-admin] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" aria-hidden />
        <h2 className="mt-4 text-lg font-bold">{t("adminSectionErrorTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("adminSectionErrorBody")}</p>
        {error.digest && (
          <p className="mt-2 font-mono text-label text-muted-foreground">#{error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={reset}>{t("tryAgain")}</Button>
          <Link
            href="/admin"
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
