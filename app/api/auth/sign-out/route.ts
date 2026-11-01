import { getAuth } from "@/lib/auth/better-auth";
import { clearSessionCookie } from "@/lib/auth/session";
import { relativeRedirect, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST (plain HTML form in the header) -> deletes this browser's session row, clears the cookie
 * and redirects to /sign-in. Works with a missing or expired session too.
 * The Location is relative: the app binds 0.0.0.0 behind Caddy, so req.url is not the public origin.
 */
export const POST = route(async (req: Request) => {
  try {
    await getAuth().api.signOut({ headers: req.headers });
  } catch {
    // No session to end (signed out already, expired or tampered cookie); clearing the cookie is enough.
  }
  const res = relativeRedirect("/sign-in", 303);
  await clearSessionCookie(res);
  return res;
});
