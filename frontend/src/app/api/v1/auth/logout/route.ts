/**
 * Next.js API Route: POST /api/v1/auth/logout
 *
 * Reads the cookie server-side, revokes the token on the backend, then
 * clears the cookie on the frontend domain — same pattern as the refresh
 * route to avoid proxy cookie-forwarding issues.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const COOKIE_NAME = "dmh_refresh";
const COOKIE_PATH = "/api/v1/auth";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;

  if (raw) {
    try {
      // Best-effort revocation — don't fail logout if backend is down.
      await fetch(`${BACKEND}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Cookie: `${COOKIE_NAME}=${raw}` },
        cache: "no-store",
      });
    } catch {
      // Swallow — cookie is cleared client-side regardless.
    }
  }

  const res = NextResponse.json({ message: "Logged out" }, { status: 200 });
  res.cookies.delete({ name: COOKIE_NAME, path: COOKIE_PATH });
  return res;
}
