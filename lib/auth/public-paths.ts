// Paths reachable without signing in. Everything else (pages and APIs) requires a session.
// Each entry matches the exact path and anything below it ("/api/webhook" matches
// "/api/webhook/x" but not "/api/webhookx"). To make a new route public, add it here.
// Public routes must do their own authentication (e.g. the webhook's shared secret).
export const PUBLIC_PATHS = [
  "/sign-in", // sign-in page
  "/api/auth/sign-in",
  "/api/auth/sign-out", // must work even with an expired session
  "/icon.svg", // favicon (also needed on the signed-out sign-in page)
  "/apple-icon", // apple-touch icon
  "/api/health", // deploy smoke test
  "/api/webhook", // inbound email (ticket 04); secured by WEBHOOK_SECRET in the handler
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
