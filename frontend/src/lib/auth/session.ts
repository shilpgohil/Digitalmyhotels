/**
 * In-memory access-token holder.
 * The access token is deliberately NOT persisted to localStorage — session
 * restoration after reload goes through the HttpOnly refresh cookie.
 */

let accessToken: string | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((fn) => fn());
}

export function clearSession(): void {
  setAccessToken(null);
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
