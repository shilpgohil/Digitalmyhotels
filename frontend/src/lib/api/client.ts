import {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  clearSession,
} from "@/lib/auth/session";

// API_BASE is intentionally EMPTY in production when the Next.js rewrite
// proxy is in use (all /api/* calls route through the same-origin Next.js
// server which forwards them to the Render backend). Setting
// NEXT_PUBLIC_API_URL on Vercel would make calls cross-origin and break
// HttpOnly cookie delivery — the refresh cookie cannot travel cross-domain.
//
// Only set NEXT_PUBLIC_API_URL when the frontend and backend share the
// same domain (e.g. custom domain with wildcard cert). Leave it UNSET on
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export { getAccessToken } from "@/lib/auth/session";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    correlationId?: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    correlation_id?: string;
    details?: unknown;
  };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  hotelId?: string;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401. */
  skipAuthRetry?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let envelope: ErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // Non-JSON error body — fall through to generic error.
  }
  const err = envelope.error;
  return new ApiError(
    response.status,
    err?.code ?? "unknown_error",
    err?.message ?? "Something went wrong. Please try again.",
    err?.correlation_id,
    err?.details,
  );
}

let refreshPromise: Promise<boolean> | null = null;

// Track the HTTP status of the last refresh attempt so callers can
// distinguish a genuine revocation (401/403) from a transient failure.
// -1 means "no attempt yet"; 0/503 means "network error / server unreachable".
let lastRefreshStatus = -1;

/** Whether the last refresh attempt was conclusively rejected by the server
 *  (vs. a network error or server spin-up timeout). Only a genuine server 4xx
 *  should trigger a session wipe — never a transient network failure.
 */
export function wasRefreshRejectedByServer(): boolean {
  // 401 = invalid/expired/revoked token   403 = account disabled
  // Anything else (0, 503, 502, etc.) is a transient infra failure.
  return lastRefreshStatus === 401 || lastRefreshStatus === 403;
}

/** Refresh the access token using the HttpOnly cookie. Deduplicates concurrent calls.
 *
 * IMPORTANT: Always uses a relative URL so the request goes through the
 * Next.js server-side proxy (same-origin from the browser's perspective).
 * This prevents cross-origin cookie blocking (3rd-party cookie deprecation
 * in Chrome/Safari) and is safe for both local dev and Vercel production.
 *
 * Dual-channel: sends the refresh token both in the HttpOnly cookie (set by
 * the backend /refresh response) AND in the request body + X-Refresh-Token
 * header (read from localStorage). The backend uses whichever arrives first,
 * so sessions survive cross-origin restrictions and cookie clearing.
 */
export async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const storedRefresh = getRefreshToken();
      const headers: Record<string, string> = {};
      let body: string | undefined;
      if (storedRefresh) {
        headers["Content-Type"] = "application/json";
        headers["X-Refresh-Token"] = storedRefresh;
        body = JSON.stringify({ refresh_token: storedRefresh });
      }

      // Relative path — ALWAYS proxied by Next.js rewrites, never cross-origin.
      // DO NOT use API_BASE here — it may point to the Render backend directly
      // which would break HttpOnly cookie delivery on Vercel (cross-origin).
      const response = await fetch(`/api/v1/auth/refresh`, {
        method: "POST",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        credentials: "include",
      });
      lastRefreshStatus = response.status;
      if (!response.ok) return false;
      const data = (await response.json()) as { access_token: string; refresh_token?: string };
      setAccessToken(data.access_token);
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
      }
      return true;
    } catch {
      // Network error / server unreachable — NOT a token rejection.
      lastRefreshStatus = 0;
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, hotelId, signal, skipAuthRetry } = options;

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (hotelId) headers["X-Hotel-Id"] = hotelId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal,
    });
  };

  let response = await doFetch();

  if (response.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await doFetch();
    } else {
      // Only wipe session when the server conclusively rejects the token
      // (401 invalid_refresh or 403 account_disabled). Network failures,
      // server spin-downs (502/503/0), or timeouts must NEVER wipe the
      // session — that is the root cause of the phantom-logout bug.
      if (wasRefreshRejectedByServer()) {
        clearSession();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("dmh:auth-expired"));
        }
      }
    }
  }

  if (!response.ok) {
    const err = await parseError(response);
    // If the server says the user must change their password, redirect there
    // instead of showing a generic "Something went wrong" on every page.
    if (response.status === 403 && (err as ApiError).code === "must_reset_password") {
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/change-password")) {
        window.location.href = "/change-password";
      }
    }
    // Hotel suspended by Super Admin — notify React components so they can
    // show the full-screen "Account Deactivated" overlay immediately, without
    // a full-page reload (which causes a flash of the normal UI first).
    if (response.status === 403 && (err as ApiError).code === "hotel_suspended") {
      if (typeof window !== "undefined") {
        // Dispatch a CustomEvent so any React listener can react instantly.
        window.dispatchEvent(new CustomEvent("dmh:hotel-suspended"));
        // Fallback hard redirect for cases where no React listener is mounted.
        if (!window.location.pathname.startsWith("/suspended")) {
          window.location.href = "/suspended";
        }
      }
    }
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Multipart upload with auth + hotel headers (no JSON content-type). */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: { hotelId?: string; method?: "POST" | "PUT" } = {},
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.hotelId) headers["X-Hotel-Id"] = options.hotelId;
    return fetch(`${API_BASE}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: formData,
      credentials: "include",
    });
  };

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await doFetch();
    } else {
      if (wasRefreshRejectedByServer()) {
        clearSession();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("dmh:auth-expired"));
        }
      }
    }
  }
  if (!response.ok) throw await parseError(response);
  // 204 (e.g. staff photo upload) has no body — response.json() would throw
  // a SyntaxError AFTER the upload succeeded (client 09/2026 Save Staff bug).
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export { apiFetch as api };
