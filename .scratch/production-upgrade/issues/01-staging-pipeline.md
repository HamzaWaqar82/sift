# 01: Staging pipeline

**What to build:** A push to `staging` deploys to a separate staging environment at `sift-staging-43-204-61-13.sslip.io`. It runs on the same EC2 host as production as its own Compose project, with its own Postgres volume and `.env`, behind the shared Caddy. After each staging deploy, a small Playwright smoke suite runs against the staging URL. Production keeps deploying only from `main` and waits for the owner's approval.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Staging stack runs alongside production without sharing a database, volume, container name or port
- [ ] Caddy serves both hostnames with TLS
- [ ] Deploy-staging workflow triggers on a successful CI run for a push to `staging`, then health-checks staging
- [ ] Playwright added as a dev dependency. The smoke suite runs only against a deployed URL (never on PRs) and starts with: the health check returns 200, the sign-in page loads, a seeded user can sign in
- [ ] Staging uses `MAIL_TRANSPORT=capture` once the mailer exists; the staging `.env` is documented in the README
- [ ] Smoke suite stays lean: **at most 4 more checks are added by later tickets** (invite accept, reply visible in the dev mailbox, live ticket arrival, claim from pool)
- [ ] Any server-side setup the owner must do is listed step by step
