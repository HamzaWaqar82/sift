# 23: UI distill and hardening

**What to build:** The interface carries less text and decoration while keeping Sift's identity. The app ships with security headers and up-to-date docs.

**Blocked by:** 06, 10, 11, 12, 17, 19, 20, 21, 22

**Status:** ready-for-agent

- [ ] `impeccable` distill pass: remove decorative or duplicated content, trim moderately, follow DESIGN.md
- [ ] `DirectionContract` scaffold removed
- [ ] Security headers: `X-Content-Type-Options`, `Referrer-Policy`, a conservative CSP. Caddy keeps HSTS
- [ ] README and PRODUCT.md describe the new auth, mail, ownership and AI behaviour, and the staging→production flow
- [ ] Smoke suite reviewed: still within the 01 cap
