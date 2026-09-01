/**
 * Next.js API Route: POST /api/v1/auth/refresh
 *
 * Why this exists instead of relying on the Next.js rewrite proxy:
 *   The rewrite proxy does NOT reliably forward the `Cookie` request header
 *   to the origin. In testing, 17 out of 18 refresh attempts arrived at the
 *   backend with no cookie → 401. This route reads the cookie SERVER-SIDE
 *   using Next.js `cookies()` and makes a direct server-to-server fetch to
 *   the backend, completely bypassing the proxy cookie problem.
 *
 * Cookie flow:
 *   Browser → (cookie for this domain) → this route (Next.js server)
 *   → server-to-server fetch to FastAPI backend (cookie in header)
 *   → backend validates token, returns new refresh token
 *   → this route re-issues the cookie for THIS domain → browser
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const COOKIE_NAME = "dmh_refresh";
const COOKIE_PATH = "/api/v1/auth";
const MAX_AGE_SEC = 14 * 24 * 3600; // 14 days

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;

  if (!raw) {
    return NextResponse.json(
      { error: { code: "missing_refresh", message: "Missing refresh token" } },
      { status: 401 },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `${COOKIE_NAME}=${raw}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "backend_unavailable", message: "Backend is starting up, please retry" } },
      { status: 503 },
    );
  }

  const body: unknown = await backendRes.json();

  if (!backendRes.ok) {
    return NextResponse.json(body, { status: backendRes.status });
  }

  // Extract new refresh token value from the backend Set-Cookie header.
  const setCookieHeader = backendRes.headers.get("set-cookie") ?? "";
  const tokenMatch = setCookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const newToken = tokenMatch?.[1];

  const res = NextResponse.json(body, { status: 200 });

  if (newToken) {
    // Re-issue the cookie for the FRONTEND domain so it's always first-party.
    res.cookies.set(COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: MAX_AGE_SEC,
    });
  }

  return res;
}
