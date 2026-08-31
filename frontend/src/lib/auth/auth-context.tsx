"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, refreshAccessToken } from "@/lib/api/client";
import { clearSession, getAccessToken, setAccessToken } from "@/lib/auth/session";
import type { MeResponse, MembershipOut, TokenResponse, UserOut } from "@/types/auth";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: UserOut | null;
  memberships: MembershipOut[];
  permissions: string[];
  activeHotelId: string | null;
  login: (email: string, password: string) => Promise<UserOut>;
  logout: () => Promise<void>;
  setActiveHotelId: (hotelId: string) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const HOTEL_KEY = "dmh.activeHotelId";

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserOut | null>(null);
  const [memberships, setMemberships] = useState<MembershipOut[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  // Underscore prefix distinguishes the raw state setter from the public
  // setActiveHotelId wrapper that also persists to sessionStorage.
  const [activeHotelId, _setActiveHotelId] = useState<string | null>(null);

  const applySession = useCallback((me: MeResponse) => {
    setUser(me.user);
    setMemberships(me.memberships);
    setPermissions(me.permissions);
    setStatus("authenticated");
    const stored = sessionStorage.getItem(HOTEL_KEY);
    const validStored = me.memberships.some((m) => m.hotel_id === stored);
    const hotelId = validStored ? stored : (me.memberships[0]?.hotel_id ?? null);
    _setActiveHotelId(hotelId);
    if (hotelId) sessionStorage.setItem(HOTEL_KEY, hotelId);
  }, []);

  // Session restoration after reload: refresh cookie → access token → /me.
  //
  // Retries up to 5 times with exponential back-off (500 ms, 1 s, 2 s, 4 s, 8 s)
  // = ~15.5 s total. This covers Render free-tier warm-ups (typically 5–15 s after
  // a keep-alive ping or first hit). Only after all retries fail is status set to
  // "unauthenticated". The keep-alive cron prevents deep cold starts (30–60 s).
  useEffect(() => {
    let cancelled = false;

    const tryRefresh = async (attempt = 0): Promise<boolean> => {
      const ok = await refreshAccessToken();
      if (ok || cancelled) return ok;
      if (attempt >= 4) return false;             // max 5 attempts
      const delay = 500 * 2 ** attempt;           // 500 ms → 1 s → 2 s → 4 s → 8 s
      await new Promise((r) => setTimeout(r, delay));
      return cancelled ? false : tryRefresh(attempt + 1);
    };

    (async () => {
      if (!getAccessToken()) {
        const ok = await tryRefresh();
        if (!ok) {
          if (!cancelled) setStatus("unauthenticated");
          return;
        }
      }
      try {
        const me = await apiFetch<MeResponse>("/api/v1/auth/me");
        if (!cancelled) applySession(me);
      } catch {
        if (!cancelled) {
          clearSession();
          setStatus("unauthenticated");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<TokenResponse>("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
        skipAuthRetry: true,
      });
      setAccessToken(data.access_token);
      const me = await apiFetch<MeResponse>("/api/v1/auth/me");
      applySession(me);
      return data.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST", skipAuthRetry: true });
    } catch {
      // Logout must always succeed client-side.
    }
    clearSession();
    sessionStorage.removeItem(HOTEL_KEY);
    setUser(null);
    setMemberships([]);
    setPermissions([]);
    _setActiveHotelId(null);
    setStatus("unauthenticated");
  }, []);

  const setActiveHotelId = useCallback((hotelId: string) => {
    _setActiveHotelId(hotelId);
    sessionStorage.setItem(HOTEL_KEY, hotelId);
  }, []);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      memberships,
      permissions,
      activeHotelId,
      login,
      logout,
      setActiveHotelId,
      can,
    }),
    [status, user, memberships, permissions, activeHotelId, login, logout, setActiveHotelId, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
