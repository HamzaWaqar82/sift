import { relativeRedirect, route } from "@/lib/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST (plain HTML form in the header) -> clears the session and redirects to /sign-in.
 * The Location is relative: the app binds 0.0.0.0 behind Caddy, so req.url is not the public origin.
 */
export const POST = route(async () => {
  const res = relativeRedirect("/sign-in", 303);
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
});
