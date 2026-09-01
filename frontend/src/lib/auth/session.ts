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

const SESSION_KEY = "dmh_access";

type Listener = () => void;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window !== "undefined") {
    if (token) {
      sessionStorage.setItem(SESSION_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }
  listeners.forEach((fn) => fn());
}

export function clearSession(): void {
  setAccessToken(null);
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
