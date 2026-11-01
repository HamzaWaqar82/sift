// Runs before every page and API route. A cheap first gate with no database access: requires a
// session cookie to be present on everything except PUBLIC_PATHS (Better Auth's recommended
// optimistic check). Route handlers and pages still call requireUser/requireAdmin/requirePageUser
// (lib/auth), which validate the session against the database, the user's status and their role.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_PREFIX } from "@/lib/auth/cookie";
import { isPublicPath } from "@/lib/auth/public-paths";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX })) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  }
  // Next's proxy adapter rejects a relative Location (500 "Invalid URL"). It does rewrite a
  // same-host redirect to a relative Location itself (getRelativeURL), so building the URL from
  // req.url is host-safe: the browser receives "Location: /sign-in", never the bound 0.0.0.0.
  return NextResponse.redirect(new URL("/sign-in", req.url), 307);
}

export const config = {
  // Skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
