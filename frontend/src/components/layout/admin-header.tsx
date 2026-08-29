"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, User } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";

export function AdminHeader() {
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/admin/hotels?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-6">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-xs">
        <div className="relative">
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
        <button
          type="button"
          className="relative flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Notifications"
        >
          <Bell className="size-4" aria-hidden />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-foreground leading-tight">
              {user?.full_name ?? "Admin User"}
            </p>
            <p className="text-[10px] text-muted-foreground">Super Admin</p>
          </div>
          <div className="flex size-8 items-center justify-center rounded-full bg-navy-900 text-white shrink-0">
            <User className="size-4" aria-hidden />
          </div>
        </div>
      </div>
    </header>
  );
}
