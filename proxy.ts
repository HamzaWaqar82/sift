// Runs before every page and API route. A cheap first gate: requires a validly signed
// session cookie on everything except PUBLIC_PATHS. Route handlers still call
// requireUser/requireAdmin (lib/auth), which also checks the user exists and their role.
import { NextResponse, type NextRequest } from "next/server";
import { relativeRedirect } from "@/lib/http";
import { isPublicPath } from "@/lib/auth/public-paths";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const userId = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (userId !== null) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  }
  // Relative on purpose: req.url holds the bound address (0.0.0.0:3000) behind the proxy.
  return relativeRedirect("/sign-in", 307);
}

export const config = {
  // Skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
