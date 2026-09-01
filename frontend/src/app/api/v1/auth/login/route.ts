/**
 * Next.js API Route: POST /api/v1/auth/login
 *
 * Proxies the login request and re-issues the refresh cookie for the
 * FRONTEND domain (vercel.app / localhost) so it's always first-party.
 * Without this, the backend sets the cookie for the Render domain which
 * browsers block as a third-party cookie when the proxy is in use.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const BACKEND = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const COOKIE_NAME = "dmh_refresh";
const COOKIE_PATH = "/api/v1/auth";
const MAX_AGE_SEC = 14 * 24 * 3600;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Invalid JSON" } }, { status: 400 });
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "backend_unavailable", message: "Backend is starting up, please retry in a moment" } },
      { status: 503 },
    );
  }

  const responseBody: unknown = await backendRes.json();

  if (!backendRes.ok) {
    return NextResponse.json(responseBody, { status: backendRes.status });
  }

  // Extract the refresh token the backend set and re-issue it for our domain.
  const setCookieHeader = backendRes.headers.get("set-cookie") ?? "";
  const tokenMatch = setCookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const refreshToken = tokenMatch?.[1];

  const res = NextResponse.json(responseBody, { status: 200 });

  if (refreshToken) {
    res.cookies.set(COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: MAX_AGE_SEC,
    });
  }

  return res;
}
