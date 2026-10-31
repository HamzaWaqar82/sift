# Sift

Support inbox triage for a small team: tickets arrive by webhook or form, an agent requests one AI triage (category, urgency, draft reply, help article), edits the draft and sends it. Nothing is sent automatically.

Stack: Next.js (App Router, TypeScript), Tailwind, Postgres, Drizzle ORM, Zod, Vitest. Docker Compose locally and in production (Caddy for HTTPS).

## What was built

- Deployable skeleton: Next.js app, Postgres, a one-off `migrate` Compose service that must complete before the app starts.
- `GET /api/health` returns `{"status":"ok","db":"up"}` (200) or `{"status":"error","db":"down"}` (503).
- Production Compose file with Caddy serving HTTPS on an sslip.io hostname.
- Sign-in with email and password for four seeded agents and one admin (`admin@sift.local`; agents `alice@`, `ben@`, `chloe@`, `dev@sift.local`). Passwords are bcrypt-hashed from `SEED_ADMIN_PASSWORD` / `SEED_AGENT_PASSWORD` by the seed step that runs after migrations. The session is a signed (HS256, `SESSION_SECRET`), httpOnly, SameSite=Lax cookie valid for 7 days; sign-out clears it.
- Every page and API requires sign-in except `/api/health`, the inbound-email webhook and the sign-in endpoints (pages redirect to `/sign-in`, APIs return 401). Route handlers enforce roles on the server with `requireUser` / `requireAdmin` (403 for the wrong role).
- Failed sign-ins are limited per client address in memory: after 5 failures in 15 minutes that address gets 429 until the window ends.
- Ticket list (`/`, `GET /api/tickets`): newest first, 20 per page, filter by status (open, replied, closed). The filter and an opaque cursor live in the URL (`/?status=open&cursor=...`); changing the filter restarts from page one; going back uses browser history. Keyset paging on `(created_at, id)` means tickets arriving between pages never cause a duplicate or a skip. Each row shows subject, customer, status, assignee, source and age.
- Ticket detail (`/tickets/:id`, `GET /api/tickets/:id`) with the full customer message, status and assignee. Any agent can close a ticket (`POST /api/tickets/:id/close`).
- Admin reassign: on the ticket detail page an admin sees a "Reassign to" picker (any user, or Unassigned); agents do not see it. `POST /api/tickets/:id/assign` with `{"assigneeId": <user id> | null}` returns 200 `{ticket}` (with `assignee`) for an admin; 403 for an agent (nothing changes), 401 when signed out, 400 for an unknown user or bad body, 404 for an unknown ticket. New tickets start unassigned; the assignee never restricts who may work a ticket.
- New-ticket form (`/tickets/new`, `POST /api/tickets`) for phone calls and chats: customer email, optional name, subject, message; source `form`; invalid input returns per-field errors.
- Sample data: `samples/emails.json` holds 14 realistic customer emails (billing, technical, account, feature requests, an angry/urgent one, a vague one, a prompt-injection attempt, one with a phone number and personal email). The seed step creates them as tickets, keyed on message id so re-running never duplicates. Two more in `samples/live/` are deliberately not seeded, for posting live through the webhook in the demo.
- The full data model is in one migration: `tickets`, `help_articles`, `triage_results` (every attempt; the ticket shows the latest), `replies` (with a unique idempotency key) and `ai_usage` (calls per UTC day).

## What was left out

- Real email delivery of replies (SES or any provider); replies are recorded in the app only.
- Threading follow-up emails into existing tickets; every inbound email creates a new ticket.
- Claiming tickets and the Mine/Unassigned filter.
- Managed database (RDS); Postgres runs in a container on the same host.
- Auto-rollback of deploys.
- Password reset and sign-up: accounts are seeded only; changing a password means editing the environment file and re-running the seed.
- Persistent or shared rate limiting: the sign-in limit lives in memory, so it resets on restart and would not be shared across several app instances.
- Category and urgency in the list only for triaged tickets (deliberate trade-off): triage runs on demand, never in the background, so a ticket nobody has opened shows "Not triaged yet" instead of a category and urgency. This keeps AI spend proportional to tickets actually looked at, at the cost of not being able to sort the queue by urgency up front.
- A Previous button and page numbers: the list pages forward with a cursor and relies on browser Back.

## Known problem and fix

_To be filled in as features land (planned: the AI daily-cap race, fixed with an atomic counter update)._

## Demo

### Agent gets 403 on reassign (server-side role check)

The UI hides the control from agents; this shows the server refuses them anyway. Signing in with curl stores the agent's session cookie (`sift_session`) in a cookie jar, the same cookie a browser gets. (Alternative: sign in as an agent in the browser, open DevTools > Application > Cookies, copy the `sift_session` value and pass it with `-H "Cookie: sift_session=<value>"`.)

```sh
BASE=https://sift-43-204-61-13.sslip.io   # or http://localhost:3000
AGENT_PASSWORD='...'                      # SEED_AGENT_PASSWORD (local default: see compose.yaml)
ADMIN_PASSWORD='...'                      # SEED_ADMIN_PASSWORD

# Sign in as an agent; the session cookie lands in agent.jar
curl -s -c agent.jar -H 'content-type: application/json' \
  -d "{\"email\":\"alice@sift.local\",\"password\":\"$AGENT_PASSWORD\"}" "$BASE/api/auth/sign-in"

# Agent tries to assign ticket 1 to user 3 -> 403 {"error":"You do not have permission to do that"}
curl -s -w '\nHTTP %{http_code}\n' -b agent.jar -H 'content-type: application/json' \
  -d '{"assigneeId":3}' "$BASE/api/tickets/1/assign"

# Same call as the admin -> 200 {"ticket":{..., "assignee":{...}}}
curl -s -c admin.jar -H 'content-type: application/json' \
  -d "{\"email\":\"admin@sift.local\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/sign-in"
curl -s -w '\nHTTP %{http_code}\n' -b admin.jar -H 'content-type: application/json' \
  -d '{"assigneeId":3}' "$BASE/api/tickets/1/assign"

rm -f agent.jar admin.jar
```

User ids come from the seed order (1 admin, then alice, ben, chloe, dev); the assignee picker on a ticket page lists them too.

## How to run locally

Requires Docker with Compose v2.

```sh
docker compose up --build
```

Open http://localhost:3000 and check http://localhost:3000/api/health. No `.env` is needed for local use; dev defaults live in `compose.yaml`. To override, `cp .env.example .env` and edit. If ports 3000/5432 are taken, set `APP_HOST_PORT` / `DB_HOST_PORT`.

Every variable is documented in `.env.example`. The real `.env` is gitignored; never commit it.

Sign in with a seeded account (see "What was built"). With no `.env`, the local passwords are the dev defaults in `compose.yaml`. Running outside Docker: `npm run db:migrate && npm run db:seed` (needs `DATABASE_URL`, `SEED_ADMIN_PASSWORD`, `SEED_AGENT_PASSWORD`), then `npm run dev` with `SESSION_SECRET` set.

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

Live: https://sift-43-204-61-13.sslip.io (EC2 t3.small in ap-south-1, Mumbai).

One-time server setup: run `./scripts/aws-deploy-wizard.sh` from the repo root. It walks you through the AWS console step by step (key pair, security group, instance, Elastic IP), then writes the production `.env` on the server, starts the stack, checks HTTPS and runs a reboot test. Local deploy values (host, key path, webhook secret, seed passwords) are saved to `.env.deploy`, which is gitignored. The manual equivalent:

1. Launch an EC2 instance (e.g. Ubuntu, t3.small), attach an Elastic IP, and open inbound ports 22, 80 and 443 in its security group.
2. Install Docker Engine and the Compose plugin; run `sudo systemctl enable --now docker` so containers come back after a reboot (all long-running services use `restart: unless-stopped`).
3. `git clone` this repository, then create `.env` by hand from `.env.example`: strong `POSTGRES_PASSWORD`, `WEBHOOK_SECRET`, `SESSION_SECRET`, seed passwords, the real `GEMINI_API_KEY`, and `PUBLIC_HOSTNAME` built from the Elastic IP. `compose.prod.yaml` refuses to start if a required value is missing. Production sign-in passwords come only from this server-side `.env` (`SEED_ADMIN_PASSWORD`, `SEED_AGENT_PASSWORD`); they are hashed into the database on each deploy and never stored in the repository.

Deploy (first time and every update), on the server:

```sh
git pull
docker compose -f compose.prod.yaml up -d --build
curl -fsS https://$PUBLIC_HOSTNAME/api/health
```

Migrations and the user seed run in the `migrate` service before the app starts; if a migration fails, Compose stops and the new app is not started. Check the certificate right after the first deploy (`docker compose -f compose.prod.yaml logs caddy`), since Let's Encrypt rate-limits repeated failures.
