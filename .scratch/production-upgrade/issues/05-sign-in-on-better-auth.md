# 05: Sign-in on Better Auth

**What to build:** Sign-in moves to Better Auth with sessions stored in the database. The five existing staff sign in with their current passwords. A user can sign out everywhere. Rate limits survive restarts.

**Blocked by:** 03

**Status:** done

- [x] Better Auth wired with the mapping chosen in 03. `users` gains `email_verified`, `availability`, `deactivated_at`, `last_assigned_at`. Existing hashes migrate into `account`, and seeded users are marked verified
- [x] Route guards keep their current signatures but resolve against database sessions. Deactivated users are rejected
- [x] Session cookie: httpOnly, Secure in production, SameSite=Lax, 7-day absolute expiry
- [x] "Sign out everywhere" revokes all of a user's sessions
- [x] `rate_limits` table: sign-in allows 5 failures per 15 min per IP and per email. Rejections are 429 with `Retry-After`. Unknown emails cost the same as known ones
- [x] `audit_log` table, with sign-in failures and session revocations recorded
- [x] The test sign-in helper uses the real endpoint. Existing tests stay green
