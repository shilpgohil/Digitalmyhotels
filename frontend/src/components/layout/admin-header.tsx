"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, Menu, User } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { useAuth } from "@/lib/auth/auth-context";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

/** Hamburger + slide-in drawer with the ADMIN navigation (mobile only).
 *  Previously mobile had no admin nav at all — and pages that borrowed the
 *  partner header exposed the HOTEL nav inside the super-admin console. */
function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground lg:hidden"
        aria-label="Open admin menu"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        {/* !w-60 forces 240px width, overriding the default data-[side=left]:w-3/4
            class which has higher CSS specificity. Without !, the sheet is 75%
            of viewport (281px on 375px phone) while sidebar is 240px → 41px gap.
            AdminSidebar now uses w-full and fills exactly this 240px container. */}
        <SheetContent
          side="left"
          className="!w-64 gap-0 glass-nav bg-background/95 p-0 text-foreground overflow-y-auto"
          aria-label="Admin menu"
        >
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          {/* alwaysExpanded: labels always visible, w-full fills the 256px drawer */}
          <AdminSidebar onNavigate={() => setOpen(false)} alwaysExpanded />
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Sum of pending items the super admin should action (renewal + password requests). */
function useAdminPendingCount() {
  const renewals = useQuery({
    queryKey: ["admin-renewal-requests", "pending"],
    queryFn: () =>
      apiFetch<{ items: unknown[]; total: number }>(
        "/api/v1/super-admin/renewal-requests?status=pending",
      ),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const pwdReqs = useQuery({
    queryKey: ["admin-password-requests", "pending"],
    queryFn: () =>
      apiFetch<unknown[]>("/api/v1/super-admin/password-requests"),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  // Renewal requests have a `total` field; password requests return a flat array.
  const n =
    (renewals.data?.total ?? 0) +
    (Array.isArray(pwdReqs.data) ? pwdReqs.data.length : 0);
  return n;
}

export function AdminHeader() {
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const pendingCount = useAdminPendingCount();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // filter=all → search across every hotel, not just active ones.
      router.push(`/admin/hotels?filter=all&q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 glass-nav bg-background/70 px-3 lg:px-6 sm:gap-4">
      <AdminMobileNav />
      <form onSubmit={handleSearch} className="flex-1 flex justify-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-full border border-input bg-muted/40 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/40"
          />
        </div>
      </form>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Bell icon — shows count of pending renewal + password requests.
            Clicking navigates to the renewal requests page for quick action. */}
        <button
          type="button"
          onClick={() => router.push("/admin/registrations")}
          className="relative flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
          aria-label={`Pending actions${pendingCount > 0 ? `: ${pendingCount}` : ""}`}
          title={pendingCount > 0 ? `${pendingCount} pending action${pendingCount !== 1 ? "s" : ""}` : "Platform notifications"}
        >
          <Bell className="size-4" aria-hidden />
          {pendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-danger px-0.5 text-micro font-bold text-white">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-foreground leading-tight truncate max-w-[120px]">
              {user?.full_name ?? "Admin User"}
            </p>
            <p className="text-micro text-muted-foreground">Super Admin</p>
          </div>
          <div className="flex size-8 items-center justify-center rounded-full bg-navy-900 text-white shrink-0">
            <User className="size-4" aria-hidden />
          </div>
        </div>
      </div>
    </header>
  );
}
