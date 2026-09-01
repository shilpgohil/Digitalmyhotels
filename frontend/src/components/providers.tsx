"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 60 s — no background refetch during
            // normal navigation. Keeps things snappy on slower connections.
            staleTime: 60_000,
            // Keep unused data in cache for 5 minutes so navigating back to a
            // page doesn't trigger a full reload.
            gcTime: 300_000,
            // Don't automatically refetch when the user switches back to the
            // browser tab — avoids unnecessary requests on Render free tier.
            refetchOnWindowFocus: false,
            // Reconnect-refetch still on so data stays fresh after network drops.
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              // Never retry auth/permission failures.
              if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
