import { getAccessToken, setAccessToken, clearSession } from "@/lib/auth/session";

// Empty = same-origin (Next.js rewrites /api to the FastAPI process).
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

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

/** Refresh the access token using the HttpOnly cookie. Deduplicates concurrent calls. */
export async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { access_token: string };
      setAccessToken(data.access_token);
      return true;
    } catch {
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
      clearSession();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
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
    if (refreshed) response = await doFetch();
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export { API_BASE };
