/**
 * Access-token holder — stored in sessionStorage so it survives page
 * refreshes (F5 / Cmd+R) without requiring a cookie round-trip every time.
 *
 * Security profile:
 *   • sessionStorage is tab-scoped: a new tab starts without a token (good).
 *   • It is cleared when the tab is closed, so long-term persistence still
 *     relies on the HttpOnly refresh cookie (which can mint a fresh token).
 *   • XSS exposure is identical to keeping it in memory — if JS is
 *     compromised the token is readable either way. sessionStorage adds no
 *     extra risk while dramatically improving UX.
 *
 * The HttpOnly refresh-cookie flow is kept as the authoritative long-term
 * credential; sessionStorage is only the short-lived cache.
 */

const KEY_ACCESS = "dmh_access";
const KEY_USER   = "dmh_user";       // cached /me response to skip the API call on reload

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
  return ss_get(KEY_ACCESS);
}

export function setAccessToken(token: string | null): void {
  if (token) { ss_set(KEY_ACCESS, token); } else { ss_del(KEY_ACCESS); }
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
  listeners.forEach((fn) => fn());
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
