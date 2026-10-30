# Sift

Support inbox triage for a small team: tickets arrive by webhook or form, an agent requests one AI triage (category, urgency, draft reply, help article), edits the draft and sends it. Nothing is sent automatically.

Stack: Next.js (App Router, TypeScript), Tailwind, Postgres, Drizzle ORM, Zod, Vitest. Docker Compose locally and in production (Caddy for HTTPS).

## What was built

- Deployable skeleton: Next.js app, Postgres, a one-off `migrate` Compose service that must complete before the app starts.
- `GET /api/health` returns `{"status":"ok","db":"up"}` (200) or `{"status":"error","db":"down"}` (503).
- Production Compose file with Caddy serving HTTPS on an sslip.io hostname.

## What was left out

- Real email delivery of replies (SES or any provider); replies are recorded in the app only.
- Threading follow-up emails into existing tickets; every inbound email creates a new ticket.
- Claiming tickets and the Mine/Unassigned filter.
- Managed database (RDS); Postgres runs in a container on the same host.
- Auto-rollback of deploys.

## Known problem and fix

_To be filled in as features land (planned: the AI daily-cap race, fixed with an atomic counter update)._

## How to run locally

Requires Docker with Compose v2.

```sh
docker compose up --build
```

Open http://localhost:3000 and check http://localhost:3000/api/health. No `.env` is needed for local use; dev defaults live in `compose.yaml`. To override, `cp .env.example .env` and edit. If ports 3000/5432 are taken, set `APP_HOST_PORT` / `DB_HOST_PORT`.

Every variable is documented in `.env.example`. The real `.env` is gitignored; never commit it.

### Running tests

Tests are API-level: they call route handlers directly against a real Postgres (never Gemini). They read `TEST_DATABASE_URL` (falling back to `DATABASE_URL`). The test setup creates that database if it does not exist and applies all migrations, so you only need a reachable Postgres server whose user may create databases.

Use **one database name per checkout/worktree** so parallel runs do not interfere, e.g. `sift_test_01`, `sift_test_04`, on one shared Postgres:

```sh
# once, if you have no Postgres running (any free host port works):
docker run -d --name sift-pg-test -e POSTGRES_USER=sift -e POSTGRES_PASSWORD=sift -p 55432:5432 postgres:17-alpine

npm install
TEST_DATABASE_URL=postgres://sift:sift@localhost:55432/sift_test_01 npm test
```

`npm run typecheck` runs the TypeScript checker. Schema changes: edit `lib/db/schema.ts`, then `npm run db:generate` to create a migration in `drizzle/`.

## How to deploy

Production is one EC2 instance with an Elastic IP running `compose.prod.yaml`: Caddy (ports 80/443, automatic Let's Encrypt certificate) -> app -> Postgres. The hostname uses sslip.io wildcard DNS, so no domain is needed: Elastic IP `203.0.113.10` -> `sift-203-0-113-10.sslip.io`.

One-time server setup:

1. Launch an EC2 instance (e.g. Ubuntu, t3.small), attach an Elastic IP, and open inbound ports 22, 80 and 443 in its security group.
2. Install Docker Engine and the Compose plugin; run `sudo systemctl enable --now docker` so containers come back after a reboot (all long-running services use `restart: unless-stopped`).
3. `git clone` this repository, then create `.env` by hand from `.env.example`: strong `POSTGRES_PASSWORD`, `WEBHOOK_SECRET`, `SESSION_SECRET`, seed passwords, the real `GEMINI_API_KEY`, and `PUBLIC_HOSTNAME` built from the Elastic IP. `compose.prod.yaml` refuses to start if a required value is missing.

Deploy (first time and every update), on the server:

```sh
git pull
docker compose -f compose.prod.yaml up -d --build
curl -fsS https://$PUBLIC_HOSTNAME/api/health
```

Migrations run in the `migrate` service before the app starts; if a migration fails, Compose stops and the new app is not started. Check the certificate right after the first deploy (`docker compose -f compose.prod.yaml logs caddy`), since Let's Encrypt rate-limits repeated failures.
