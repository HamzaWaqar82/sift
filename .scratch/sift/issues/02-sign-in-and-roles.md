# 02: Sign-in with agent and admin roles

**What to build:** Users sign in with email and password and see a signed-in shell showing their name and role. Everything except the webhook and health check requires sign-in.

**Time box:** 1:15–2:00 (45 min)

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Four agents and one admin are seeded with hashed passwords taken from configuration; no sign-up exists
- [ ] Sign-in sets a signed session that persists across reloads; sign-out ends it
- [ ] Unauthenticated requests to pages and APIs (except webhook and health) are rejected or redirected
- [ ] Repeated failed sign-ins from one address are slowed or blocked
- [ ] The header shows the user's name and role
- [ ] API-level tests cover: good and bad credentials, protected route rejects anonymous, rate limit trips
- [ ] README: "left out" notes no password reset or sign-up; note that production passwords come from the server's environment file

