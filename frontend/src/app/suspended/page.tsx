"use client";

/**
 * Hotel Suspended — full-screen replacement shown whenever the backend
 * returns { code: "hotel_suspended" }. Replaces the entire UI so staff
 * cannot accidentally use any feature while the hotel is deactivated.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertOctagon, LogOut, Phone } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";

export default function SuspendedPage() {
  const { user, logout } = useAuth();
  const t = useTranslations("suspension");

  // Prevent browser back-button from going to a broken page.
  useEffect(() => {
    window.history.pushState(null, "", "/suspended");
    window.addEventListener("popstate", () => {
      window.history.pushState(null, "", "/suspended");
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6 text-center">
      {/* Red warning icon */}
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-red-500/10">
        <AlertOctagon className="size-10 text-red-400" aria-hidden />
      </div>

      <h1 className="font-display text-3xl font-bold text-white">
        {t("title")}
      </h1>
      <p className="mt-3 max-w-md text-base text-white/60 leading-relaxed">
        {t("body")}
      </p>

      {/* Contact block */}
      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70 max-w-sm w-full">
        <p className="font-semibold text-white/90 mb-2">{t("contactTitle")}</p>
        <div className="flex items-center justify-center gap-2">
          <Phone className="size-4 shrink-0" aria-hidden />
          <a href="mailto:support@digitalmyhotels.in" className="text-gold-400 hover:underline">
            support@digitalmyhotels.in
          </a>
        </div>
      </div>

      {/* Logged-in-as info */}
      {user && (
        <p className="mt-6 text-xs text-white/30">
          {t("loggedInAs", { name: user.full_name })}
        </p>
      )}

      {/* Logout */}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white/60 hover:border-white/40 hover:text-white transition-colors"
      >
        <LogOut className="size-4" aria-hidden />
        {t("signOut")}
      </button>
    </div>
  );
}
