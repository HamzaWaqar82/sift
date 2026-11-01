// Kept apart from better-auth.ts so the proxy can read it without loading Better Auth or the database.

/** Session cookies are named `sift.session_token` (prefixed `__Secure-` in production). */
export const COOKIE_PREFIX = "sift";
