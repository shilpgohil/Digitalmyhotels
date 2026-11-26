"use client";

/**
 * Route-level error boundary for the Partner Portal.
 * Automatically recovers once on stale post-deploy ChunkLoadError so
 * tapping a bottom-bar link after a Vercel deploy reloads the new build cleanly
 * instead of dumping users on Next.js's fatal "Application error" screen.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function isStaleChunkError(err: Error): boolean {
  const msg = `${err?.name ?? ""} ${err?.message ?? ""}`;
  return (
    err?.name === "ChunkLoadError" ||
    msg.includes("Loading chunk") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed")
  );
}

export default function PartnerError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    console.error("[partner] route error:", error);
    if (isStaleChunkError(error)) {
      try {
        const last = Number(window.sessionStorage.getItem("dmh_chunk_reload") || "0");
        if (Date.now() - last > 15_000) {
          window.sessionStorage.setItem("dmh_chunk_reload", String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex flex-1 min-h-[55vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" aria-hidden />
        <h2 className="mt-4 text-lg font-bold text-foreground">{t("sectionErrorTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("sectionErrorBody")}</p>
        {error.digest && (
          <p className="mt-2 font-mono text-label text-muted-foreground">#{error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              if (isStaleChunkError(error)) {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="gap-1.5"
          >
            <RefreshCw className="size-4" aria-hidden />
            {t("tryAgain")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.assign("/dashboard")}
          >
            {t("backToDashboard")}
          </Button>
        </div>
      </div>
    </div>
  );
}
