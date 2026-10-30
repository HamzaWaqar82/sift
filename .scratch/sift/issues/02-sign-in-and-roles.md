# 02: Sign-in with agent and admin roles

**What to build:** Users sign in with email and password and see a signed-in shell showing their name and role. Everything except the webhook and health check requires sign-in.

**Time box:** 1:15–2:00 (45 min)

**Blocked by:** 01

**Status:** done

- [x] Four agents and one admin are seeded with hashed passwords taken from configuration; no sign-up exists
- [x] Sign-in sets a signed session that persists across reloads; sign-out ends it
- [x] Unauthenticated requests to pages and APIs (except webhook and health) are rejected or redirected
- [x] Repeated failed sign-ins from one address are slowed or blocked
- [x] The header shows the user's name and role
- [x] API-level tests cover: good and bad credentials, protected route rejects anonymous, rate limit trips
- [x] README: "left out" notes no password reset or sign-up; note that production passwords come from the server's environment file

