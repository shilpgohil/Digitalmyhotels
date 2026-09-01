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
import { clearSession, getAccessToken, getCachedUser, setCachedUser, setAccessToken } from "@/lib/auth/session";
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

  // Session restoration after reload.
  //
  // Fast path (most reloads): the access token is still in sessionStorage →
  // skip refresh entirely, call /me directly.
  //
  // Slow path (new tab / tab-close-and-reopen / token expired):
  // call /api/v1/auth/refresh using the HttpOnly cookie, retrying up to 5
  // times with exponential back-off (500 ms … 8 s = ~15.5 s total) to cover
  // Render free-tier warm-ups.  Only after all retries fail does status
  // become "unauthenticated".
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
      // ── Fastest path: token + user both in sessionStorage (normal page F5) ──
      // Skip the /me round-trip entirely — no loading spinner, instant restore.
      const cachedToken = getAccessToken();
      const cachedMe = getCachedUser<MeResponse>();
      if (cachedToken && cachedMe) {
        if (!cancelled) applySession(cachedMe);
        return;
      }

      // ── Need a fresh token (new tab, tab closed, token expired) ──
      if (!cachedToken) {
        const ok = await tryRefresh();
        if (!ok) {
          if (!cancelled) setStatus("unauthenticated");
          return;
        }
      }

      // ── Call /me to load user profile ──
      try {
        const me = await apiFetch<MeResponse>("/api/v1/auth/me");
        if (!cancelled) {
          setCachedUser(me);   // cache for next refresh
          applySession(me);
        }
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
      setCachedUser(me);   // cache so next F5 is instant
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
