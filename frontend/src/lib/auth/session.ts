/**
 * Access-token holder — primary in sessionStorage (tab-scoped security),
 * with a localStorage backup so hard-refresh (Ctrl+F5) doesn't force a
 * full logout. The localStorage copy carries a 60-minute expiry; it is
 * only used if sessionStorage is empty (i.e., after a hard refresh that
 * wiped it). The HttpOnly refresh-cookie is still the authoritative
 * long-term credential.
 *
 * Fix (client 9-10 row 5): super-admin hard refresh was causing immediate
 * logout because sessionStorage was cleared by the browser before the
 * refresh-cookie round-trip completed.
 */

const KEY_ACCESS = "dmh_access";
const KEY_USER   = "dmh_user";       // cached /me response to skip the API call on reload
const LS_ACCESS  = "dmh_access_ls";  // localStorage backup with expiry
const LS_TTL_MS  = 60 * 60 * 1000;  // 60 minutes

type Listener = () => void;
const listeners = new Set<Listener>();

function ss_get(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function ss_set(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, value); } catch { /* storage full — ignore */ }
}
function ss_del(key: string): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

export function getAccessToken(): string | null {
  // Primary: sessionStorage (cleared by hard refresh)
  const ss = ss_get(KEY_ACCESS);
  if (ss) return ss;
  // Fallback: localStorage backup (survives hard refresh, has TTL)
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_ACCESS);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    if (Date.now() > exp) { localStorage.removeItem(LS_ACCESS); return null; }
    // Warm up sessionStorage so subsequent calls use the fast path.
    ss_set(KEY_ACCESS, token);
    return token;
  } catch { return null; }
}

export function setAccessToken(token: string | null): void {
  if (token) {
    ss_set(KEY_ACCESS, token);
    // Write localStorage backup with TTL
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(LS_ACCESS, JSON.stringify({ token, exp: Date.now() + LS_TTL_MS }));
      }
    } catch { /* storage full — ignore */ }
  } else {
    ss_del(KEY_ACCESS);
    if (typeof window !== "undefined") {
      try { localStorage.removeItem(LS_ACCESS); } catch { /* ignore */ }
    }
  }
  listeners.forEach((fn) => fn());
}

/** Cache the /me response in sessionStorage so a page-refresh doesn't need the round-trip. */
export function setCachedUser(me: unknown): void {
  if (me) { ss_set(KEY_USER, JSON.stringify(me)); } else { ss_del(KEY_USER); }
}

export function getCachedUser<T>(): T | null {
  const raw = ss_get(KEY_USER);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function clearSession(): void {
  ss_del(KEY_ACCESS);
  ss_del(KEY_USER);
  if (typeof window !== "undefined") {
    try { localStorage.removeItem(LS_ACCESS); } catch { /* ignore */ }
  }
  listeners.forEach((fn) => fn());
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
