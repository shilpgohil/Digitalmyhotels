"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleHelp, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/auth-context";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { GlobalSearch } from "@/components/layout/global-search";
import { useProductTour } from "@/components/tour/product-tour";

function initials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PartnerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTranslations("auth");
  const tt = useTranslations("tour");
  const { user, logout } = useAuth();
  const router = useRouter();
  // Use startTourInPlace — the user is already on a partner page,
  // so the tour runs contextually without navigating away.
  const { startTourInPlace } = useProductTour();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
      <div className="min-w-0">
        {subtitle && (
          <p className="text-[10px] font-semibold tracking-widest text-gold-600 uppercase">
            {subtitle}
          </p>
        )}
        <h1 className="truncate font-display text-2xl text-foreground">{title}</h1>
      </div>
      <GlobalSearch />
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={startTourInPlace}
          className="flex size-9 items-center justify-center rounded-full border text-muted-foreground hover:text-foreground"
          aria-label={tt("helpButton")}
          title={tt("helpButton")}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
        <span data-tour="bell">
          <NotificationsBell />
        </span>
        <span data-tour="locale">
          <LocaleSwitcher />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            aria-label="User menu"
          >
            {initials(user?.full_name)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              <span className="block text-sm">{user?.full_name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user?.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} variant="destructive">
              <LogOut className="size-4" aria-hidden />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
