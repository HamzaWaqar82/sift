import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** POST (plain HTML form in the header) -> clears the session and redirects to /sign-in. */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/sign-in", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}
