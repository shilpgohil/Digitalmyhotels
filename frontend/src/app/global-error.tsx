"use client";

/**
 * Root global-error fallback (renders outside NextIntlClientProvider if root crashes).
 * Auto-reloads once on post-deploy ChunkLoadError and shows a clean reload card otherwise.
 */

import { useEffect } from "react";

function isStaleChunkError(err: Error): boolean {
  const msg = `${err?.name ?? ""} ${err?.message ?? ""}`;
  return (
    err?.name === "ChunkLoadError" ||
    msg.includes("Loading chunk") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed")
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] unhandled error:", error);
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
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-bold">Something went wrong</h2>
          <p className="mt-1.5 text-sm text-slate-600">
            A new update may have been deployed. Reload the page to continue cleanly.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Reload Page
            </button>
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
