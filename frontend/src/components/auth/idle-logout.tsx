"use client";

/**
 * IdleLogout — signs the user out after 15 minutes of inactivity
 * (client 15/09/2026, plan §7.2; master context mandates session expiry).
 *
 * TIMESTAMP-BASED by design (scenario S2): mobile browsers freeze timers in
 * background tabs, so a plain setTimeout would never fire — or fire wrongly
 * on return. Instead, the last-activity time is compared on a 30s interval
 * AND whenever the tab becomes visible again, so backgrounding the app for
 * 20 minutes logs out the moment it is reopened.
 *
 * A warning toast fires one minute before the deadline.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";

const ENABLE_IDLE_LOGOUT = process.env.NEXT_PUBLIC_ENABLE_IDLE_LOGOUT === "true";
const IDLE_LIMIT_MS = 15 * 60_000;
const WARN_BEFORE_MS = 60_000;

export function IdleLogout() {
  const { status, logout } = useAuth();
  const t = useTranslations("auth");
  const lastActivity = useRef(Date.now());
  const warned = useRef(false);
  const loggingOut = useRef(false);

  useEffect(() => {
    // Disabled by default so users stay logged in until they explicitly log out
    if (!ENABLE_IDLE_LOGOUT) return;
    if (status !== "authenticated") return;
    lastActivity.current = Date.now();
    warned.current = false;
    loggingOut.current = false;

    const bump = () => {
      lastActivity.current = Date.now();
      warned.current = false;
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    const check = () => {
      if (loggingOut.current) return;
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_LIMIT_MS) {
        loggingOut.current = true;
        toast.info(t("idleLoggedOut"));
        void logout();
      } else if (idle >= IDLE_LIMIT_MS - WARN_BEFORE_MS && !warned.current) {
        warned.current = true;
        toast.warning(t("idleWarning"));
      }
    };
    const interval = setInterval(check, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [status, logout, t]);

  return null;
}
