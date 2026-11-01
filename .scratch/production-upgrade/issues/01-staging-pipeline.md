# 01: Staging pipeline

**What to build:** A push to `staging` deploys to a separate staging environment at `sift-staging-43-204-61-13.sslip.io`. It runs on the same EC2 host as production as its own Compose project, with its own Postgres volume and `.env`, behind the shared Caddy. After each staging deploy, a small Playwright smoke suite runs against the staging URL. Production keeps deploying only from `main` and waits for the owner's approval.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Staging stack runs alongside production without sharing a database, volume, container name or port
- [ ] Caddy serves both hostnames with TLS
- [x] Deploy-staging workflow triggers on a successful CI run for a push to `staging`, then health-checks staging
- [x] Playwright added as a dev dependency. The smoke suite runs only against a deployed URL (never on PRs) and starts with: the health check returns 200, the sign-in page loads, a seeded user can sign in
- [x] Staging uses `MAIL_TRANSPORT=capture` once the mailer exists; the staging `.env` is documented in the README
- [x] Smoke suite stays lean: **at most 4 more checks are added by later tickets** (invite accept, reply visible in the dev mailbox, live ticket arrival, claim from pool)
- [x] Any server-side setup the owner must do is listed step by step

## Owner steps

Design: production's Caddy (compose.prod.yaml) also serves `STAGING_HOSTNAME`, proxying to `sift-staging-app:3000` over the `sift-edge` Docker network that compose.prod.yaml creates. The staging project (`compose.staging.yaml`, name `sift-staging`) joins that network as external and never touches production containers. "Caddy serves both hostnames with TLS" stays unticked until steps 1-2 are done.

1. **Production `.env`** (`~/sift/.env` on the server): add `STAGING_HOSTNAME=sift-staging-43-204-61-13.sslip.io`.
2. **Promote this ticket to `main` early.** GitHub only fires `workflow_run` workflows whose file is on the default branch, so `deploy-staging.yml` does nothing until it is on `main`; likewise the `sift-edge` network and the staging Caddy site only exist after a production deploy that includes this ticket. Promote it early (`staging -> main` PR, approve the deploy). Caddy is recreated once by that deploy. Do not `docker network create sift-edge` by hand; Compose owns it. Until both have happened, staging does not deploy.
3. **Staging checkout:** `cd ~ && git clone https://github.com/HamzaWaqar82/sift.git sift-staging && cd sift-staging && git checkout staging`.
4. **Staging `.env`** (`~/sift-staging/.env`, `chmod 600`), every value different from production:
   ```
   POSTGRES_USER=sift
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   POSTGRES_DB=sift_staging
   GEMINI_API_KEY=<key; a separate one keeps staging spend apart>
   AI_DAILY_CAP=20
   WEBHOOK_SECRET=<openssl rand -hex 32>
   SESSION_SECRET=<openssl rand -hex 32>
   SEED_PASSWORD_ADMIN=<random>
   SEED_PASSWORD_ALICE=<random>
   SEED_PASSWORD_BEN=<random>
   SEED_PASSWORD_CHLOE=<random>
   SEED_PASSWORD_DEV=<random>
   MAIL_TRANSPORT=capture
   ```
   Then `docker compose -f compose.staging.yaml up -d --build` once and check `curl -fsS https://sift-staging-43-204-61-13.sslip.io/api/health` (after step 2; check `docker compose -f ~/sift/compose.prod.yaml logs caddy` for the certificate).
5. **GitHub environment `staging`** (Settings -> Environments -> New). If you restrict deployment branches, allow `main`: `workflow_run` jobs run with the default branch as their ref, even though they deploy the `staging` commit:
   - Secrets: `DEPLOY_HOST` (Elastic IP), `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (same values as `production`), `SMOKE_EMAIL=alice@sift.local`, `SMOKE_PASSWORD=<staging SEED_PASSWORD_ALICE>`.
   - Variables: `STAGING_HOSTNAME=sift-staging-43-204-61-13.sslip.io`; `DEPLOY_PATH=sift-staging` and `DEPLOY_USER=ubuntu` only if they differ from those defaults.
6. **GitHub environment `production`:** set Required reviewers to yourself and deployment branches to `main` only, if not already.
7. Disk: two stacks build on one t3.small. If space runs low, `docker image prune -f` after deploys.
