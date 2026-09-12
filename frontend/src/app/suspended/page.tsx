"use client";

/**
 * Hotel Suspended — full-screen replacement shown whenever the backend
 * returns { code: "hotel_suspended" }. Replaces the entire UI so staff
 * cannot accidentally use any feature while the hotel is deactivated.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertOctagon, LogOut, Mail, Phone } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";

export default function SuspendedPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const t = useTranslations("suspension");

  // Sign out AND land on the login screen (client 09/2026).
  const signOutToLogin = async () => {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  };

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
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-danger/10">
        <AlertOctagon className="size-10 text-danger" aria-hidden />
      </div>

      <h1 className="font-display text-3xl font-bold text-white">
        {t("title")}
      </h1>
      {/* Wider body so the message reads in ~3 lines (client 09/2026) */}
      <p className="mt-3 max-w-xl text-base text-white/60 leading-relaxed">
        {t("body")}
      </p>

      {/* Contact block — email + phone (client 09/2026) */}
      <div className="mt-8 w-full max-w-md rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70">
        <p className="font-semibold text-white/90 mb-3">{t("contactTitle")}</p>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Mail className="size-4 shrink-0" aria-hidden />
            <a
              href="mailto:support@digitalmyhotels.com"
              className="text-gold-400 hover:underline"
            >
              support@digitalmyhotels.com
            </a>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Phone className="size-4 shrink-0" aria-hidden />
            <a href="tel:+919998622002" className="text-gold-400 hover:underline">
              +91 99986 22002
            </a>
          </div>
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
        onClick={() => void signOutToLogin()}
        className="mt-6 inline-flex h-[42px] items-center gap-2 rounded-lg border border-white/20 px-4 text-sm text-white/60 hover:border-white/40 hover:text-white transition-colors"
      >
        <LogOut className="size-4" aria-hidden />
        {t("signOut")}
      </button>
    </div>
  );
}
