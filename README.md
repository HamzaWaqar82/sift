# Sift

Support inbox triage for a small team: tickets arrive by webhook or form, an agent requests one AI triage (category, urgency, draft reply, help article), edits the draft and sends it. Nothing is sent automatically.

Stack: Next.js (App Router, TypeScript), Tailwind, Postgres, Drizzle ORM, Zod, Vitest. Docker Compose locally and in production (Caddy for HTTPS).

## What was built

- Deployable skeleton: Next.js app, Postgres, a one-off `migrate` Compose service that must complete before the app starts.
- `GET /api/health` returns `{"status":"ok","db":"up"}` (200) or `{"status":"error","db":"down"}` (503).
- Production Compose file with Caddy serving HTTPS on an sslip.io hostname.
- Sign-in with email and password for four seeded agents and one admin (`admin@sift.local`; agents `alice@`, `ben@`, `chloe@`, `dev@sift.local`). Each account has its own password (`SEED_PASSWORD_ADMIN`, `SEED_PASSWORD_ALICE`, `SEED_PASSWORD_BEN`, `SEED_PASSWORD_CHLOE`, `SEED_PASSWORD_DEV`), bcrypt-hashed by the seed step that runs after migrations; changing a value and redeploying updates that user's password. The session is a signed (HS256, `SESSION_SECRET`), httpOnly, SameSite=Lax cookie valid for 7 days; sign-out clears it.
- Every page and API requires sign-in except `/api/health`, the inbound-email webhook and the sign-in endpoints (pages redirect to `/sign-in`, APIs return 401). Route handlers enforce roles on the server with `requireUser` / `requireAdmin` (403 for the wrong role).
- Failed sign-ins are limited per client address in memory: after 5 failures in 15 minutes that address gets 429 until the window ends.
- Ticket list (`/`, `GET /api/tickets`): newest first, 20 per page, filter by status (open, replied, closed). The filter and an opaque cursor live in the URL (`/?status=open&cursor=...`); changing the filter restarts from page one; going back uses browser history. Keyset paging on `(created_at, id)` means tickets arriving between pages never cause a duplicate or a skip. Each row shows subject, customer, status, assignee, source and age.
- Ticket detail (`/tickets/:id`, `GET /api/tickets/:id`) with the full customer message, status and assignee. Any agent can close a ticket (`POST /api/tickets/:id/close`).
- Admin reassign: on the ticket detail page an admin sees a "Reassign to" picker (any user, or Unassigned); agents do not see it. `POST /api/tickets/:id/assign` with `{"assigneeId": <user id> | null}` returns 200 `{ticket}` (with `assignee`) for an admin; 403 for an agent (nothing changes), 401 when signed out, 400 for an unknown user or bad body, 404 for an unknown ticket. New tickets start unassigned; the assignee never restricts who may work a ticket.
- New-ticket form (`/tickets/new`, `POST /api/tickets`) for phone calls and chats: customer email, optional name, subject, message; source `form`; invalid input returns per-field errors.
- Sample data: `samples/emails.json` holds 14 realistic customer emails (billing, technical, account, feature requests, an angry/urgent one, a vague one, a prompt-injection attempt, one with a phone number and personal email). The seed step creates them as tickets, keyed on message id so re-running never duplicates. Two more in `samples/live/` are deliberately not seeded, for posting live through the webhook in the demo.
- Inbound-email webhook (`POST /api/webhook`): a JSON email with the `x-webhook-secret` header becomes a ticket with source `webhook`. Secret compared in constant time, 64 KiB body limit, 400 with a reason for bad payloads, and re-posting a message id returns the existing ticket instead of a duplicate. Contract and demo `curl` under "Webhook (inbound email)".
- Reply and audit (`POST /api/tickets/:id/replies` with `{body, idempotencyKey}`, `GET` lists the thread): on the ticket page the reply box starts with the latest valid AI draft (empty otherwise), and the agent edits it and clicks Send; nothing is sent automatically. Each reply records the ticket, the AI draft (read from the stored triage on the server, not from the browser), the final text, who sent it, when, and an edited flag computed on the server. Sending sets the ticket to replied; empty replies are rejected; a per-compose idempotency key makes a double click record one reply. Any agent can reply to any ticket, with or without triage. **Replies are recorded in the app only: no email is delivered to the customer** (SES left out).
- The full data model is in one migration: `tickets`, `help_articles`, `triage_results` (every attempt; the ticket shows the latest), `replies` (with a unique idempotency key) and `ai_usage` (calls per UTC day).
- AI triage on demand (`POST /api/tickets/:id/triage`, read with `GET`): one Gemini call (`@google/genai`, model from `GEMINI_MODEL`, JSON output against a schema, 1500 max output tokens) returns category, urgency, draft reply and the help article it is based on. The output is re-validated with Zod (fixed category/urgency lists, non-empty draft up to 2000 characters, article id null or an existing article). Any failure (provider error, bad JSON, wrong shape, invented article) is stored as an error with the raw output; the panel shows the error with the raw output collapsed, never a draft, and the agent can retry. A valid result is cached on the ticket: later visits and requests return it without another call. All provider access is one function (`runTriageModel` in `lib/triage/provider.ts`), the only thing tests fake.
- Ten short help articles (`samples/help-articles.json`, seeded into `help_articles`) cover the sample topics; all of them are included in the prompt (no retrieval).
- Help article beside the reply: next to the reply editor the agent sees the title and full text of the article the latest valid AI draft is based on, so they can check the draft against its source; a draft that cites no article is labelled "Not grounded — review carefully". The ticket detail API (`GET /api/tickets/:id`) exposes this as `ticket.grounding` (`null` = no valid triage, `{article: null}` = ungrounded, `{article: {id, title, body}}` otherwise). Because an invented article id fails triage, only real articles ever reach the panel.
- Triage cost per ticket (default `gemini-3.5-flash-lite`, $0.30 / $2.50 per 1M input / output tokens): the prompt is about 2k tokens (10 articles ≈ 1.2k, instructions ≈ 0.4k, email ≤ 0.3k) and a reply about 300, so 2,000 × $0.30/1M + 300 × $2.50/1M ≈ $0.0006 + $0.00075 ≈ **$0.0014 per ticket**. Worst case (4k in, full 1,500 out) is $0.0012 + $0.00375 ≈ $0.005. Each ticket costs at most one call because results are cached; at 50 calls a day the worst case is about $0.25/day (~$7.50/month).
- Prompt injection: the customer's email is placed in the prompt between `<customer_ticket>` tags as untrusted data (tags inside the text are neutralised) and the instructions tell the model never to follow it. This lowers the risk but no prompt-level defence is complete (sample `Question about my subscription` tries it). The real control is human review: the AI only suggests a draft, an agent reads and edits it, and nothing is ever sent automatically.
- Daily AI cap: at most `AI_DAILY_CAP` (default 50) provider calls per UTC day, counted in `ai_usage`. Every provider call counts (first triage, retry after an error, regenerate); cached results do not. At the cap `POST /api/tickets/:id/triage` returns **429** `{"error": "The daily AI limit (N triage calls) has been reached. Write the reply manually; AI triage is available again tomorrow (UTC).", "code": "ai_daily_cap_reached"}` without calling the provider or storing anything; the panel shows that message and replying works as normal. The count resets at 00:00 UTC.
- Redaction: email addresses and phone numbers (digit runs of 9+ digits with spaces, dots, dashes, parentheses or a leading `+`) are replaced with `[email removed]` / `[phone removed]` in the subject and body before they are sent to the provider (`lib/triage/redact.ts`). The stored ticket is unchanged. Dates, amounts and short order numbers are kept.
- Admin regenerate: `POST /api/tickets/:id/triage` with `{"force": true}` makes a new call even over a valid result and the new result replaces it. Admin only: an agent gets 403 and nothing is called. The "Regenerate (admin)" button is shown only to admins. Agents can still retry after a failed triage (plain `POST`, no body). A malformed body returns 400.
- Ticket list shows category and urgency badges from the ticket's latest valid triage ("Triage failed" if every attempt failed, "Not triaged yet" otherwise). A failed regenerate never replaces the last valid result: draft, article and badges all keep using it.

## What was left out

- Real email delivery of replies (SES or any provider); replies are recorded in the app only.
- Threading follow-up emails into existing tickets; every inbound email creates a new ticket.
- Vendor-specific inbound-email formats (SES, SendGrid, Mailgun, Postmark parse webhooks, raw MIME, attachments): the webhook accepts only this project's own JSON shape, the same one as `samples/`. A real provider would need a small adapter in front.
- Claiming tickets and the Mine/Unassigned filter.
- Managed database (RDS); Postgres runs in a container on the same host.
- Auto-rollback of deploys.
- Password reset and sign-up: accounts are seeded only; changing a password means editing the environment file and re-running the seed.
- Persistent or shared rate limiting: the sign-in limit lives in memory, so it resets on restart and would not be shared across several app instances.
- Category and urgency in the list only for triaged tickets (deliberate trade-off): triage runs on demand, never in the background, so a ticket nobody has opened shows "Not triaged yet" instead of a category and urgency. This keeps AI spend proportional to tickets actually looked at, at the cost of not being able to sort the queue by urgency up front.
- A Previous button and page numbers: the list pages forward with a cursor and relies on browser Back.
- Retrieval for help articles: the whole article set (ten short articles) is placed in every prompt. That stops scaling at a few dozen articles (prompt cost and model attention); the scaling path is retrieval with embeddings (embed the articles, store vectors, e.g. pgvector, and put only the top few matches for the ticket in the prompt).

## Trade-offs

- **One EC2 instance, Postgres in a container.** Cheap and simple to hand-deploy; no failover, and backups are manual. The production path below moves the database to RDS.
- **Triage on demand, cached per ticket.** AI spend follows tickets an agent actually opens (at most one call per ticket, plus explicit retries/regenerates), at the cost of no urgency sorting for untouched tickets.
- **Human in the loop instead of automation.** The AI only suggests; an agent edits and sends every reply. Slower than auto-reply, but it is the real control against wrong drafts and prompt injection.
- **Whole article set in every prompt.** No retrieval to build or tune; fine for ten articles, not for hundreds (see "What was left out").
- **In-memory sign-in rate limit and a check-then-increment AI cap.** Simple, correct for one instance and four agents; the cap's race is the known problem below.

## Free-tier data risk

On a **free-tier Gemini key, Google may use the prompts (ticket text) to improve its products**. Redaction of email addresses and phone numbers reduces what is shared but does not remove it: names, account details and free text still go out. Production should use a paid (billing-enabled) key, whose prompts are not used that way, and customers should be told an AI provider processes their messages.

## Webhook (inbound email)

`POST /api/webhook`, public (no session) but secured by a shared secret.

- Header `x-webhook-secret: <WEBHOOK_SECRET>` (dev default in `compose.yaml`: `dev-webhook-secret`). Compared in constant time. If the server has no `WEBHOOK_SECRET`, every request is refused.
- Body: JSON, at most 64 KiB, exactly the shape of `samples/emails.json` entries:

```json
{
  "from": { "email": "marcus.reid@hollowayfoods.com", "name": "Marcus Reid" },
  "subject": "URGENT: data export fails every time, payroll due today",
  "body": "Hi, ...",
  "received_at": "2026-10-31T09:30:00Z",
  "message_id": "<mr-live-01-export@hollowayfoods.com>"
}
```

  `from.name` and `received_at` are optional; everything else is required (`subject` up to 500 chars, `body` up to 50,000). `received_at`, if sent, must be ISO 8601 with offset but is ignored: the ticket's creation time (and list order) is when Sift received the webhook. `message_id` is the idempotency key.
- Responses (JSON):
  - `201 {ticket, created: true}`: new ticket, source `webhook`. Every new message id creates a new ticket (no threading).
  - `200 {ticket, created: false}`: this message id was already received; the existing ticket is returned unchanged.
  - `400 {error}`: body is not JSON; `400 {error, fields}`: payload invalid, `fields` maps each bad field (e.g. `from.email`, `message_id`) to a reason.
  - `401 {error}`: secret header missing or wrong.
  - `413 {error}`: body over 64 KiB (checked on the declared length and while reading).

Demo: post the two unseeded live samples (from the repo root). Against the live site, `.env.deploy` holds the secret:

```sh
set -a; . ./.env.deploy; set +a   # live site; locally use WEBHOOK_SECRET=dev-webhook-secret
SIFT_URL=https://sift-43-204-61-13.sslip.io   # or http://localhost:3000
for f in samples/live/01-export-failing-urgent.json samples/live/02-add-team-member.json; do curl -sS -X POST "$SIFT_URL/api/webhook" -H "content-type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" --data-binary @"$f"; echo; done
```

Running it a second time returns `200` with `"created":false` for both and adds nothing.

## Known problem and fix

**The daily AI cap can be overshot by simultaneous requests.** `takeDailySlot` in `lib/triage/usage.ts` first reads today's `ai_usage.calls`, compares it with `AI_DAILY_CAP`, and only then increments it in a second statement. Two triage requests arriving at the same moment when one slot is left can both read `calls = cap - 1`, both pass the check and both call Gemini, so the day ends at `cap + 1` (or more with more concurrent requests). With four agents the overshoot is small, but it is a real hole in a spend control.

**Fix:** reserve the slot with one atomic statement before calling the provider, and refuse when it returns no row:

```sql
INSERT INTO ai_usage (day, calls) VALUES ($today, 1)
ON CONFLICT (day) DO UPDATE SET calls = ai_usage.calls + 1
WHERE ai_usage.calls < $cap
RETURNING calls;
```

Postgres takes a row lock for the conflicting update, so concurrent requests are serialised on the counter and at most `cap` of them get a row back. (A cap of 0 needs the insert branch guarded too, e.g. skip the call when `cap = 0`.) It was left as the simple check-then-increment deliberately, as the documented known problem.

## Demo

The 15-minute walkthrough, with every click and `curl` (webhook, live triage, edited reply, agent 403 vs admin 200 on reassign), is in [`docs/DEMO.md`](docs/DEMO.md).

## How to run locally

Requires Docker with Compose v2.

```sh
docker compose up --build
```

Open http://localhost:3000 and check http://localhost:3000/api/health. No `.env` is needed for local use; dev defaults live in `compose.yaml`. To override, `cp .env.example .env` and edit. If ports 3000/5432 are taken, set `APP_HOST_PORT` / `DB_HOST_PORT`.

Every variable is documented in `.env.example`. The real `.env` is gitignored; never commit it.

Sign in with a seeded account (see "What was built"). With no `.env`, the local passwords are the dev defaults in `compose.yaml`. Running outside Docker: `npm run db:migrate && npm run db:seed` (needs `DATABASE_URL` and the five `SEED_PASSWORD_*` values), then `npm run dev` with `SESSION_SECRET` set.

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
3. `git clone` this repository, then create `.env` by hand from `.env.example`: strong `POSTGRES_PASSWORD`, `WEBHOOK_SECRET`, `SESSION_SECRET`, seed passwords, the real `GEMINI_API_KEY`, and `PUBLIC_HOSTNAME` built from the Elastic IP. `compose.prod.yaml` refuses to start if a required value is missing. Production sign-in passwords come only from this server-side `.env` (`SEED_PASSWORD_ADMIN`, `SEED_PASSWORD_ALICE`, `SEED_PASSWORD_BEN`, `SEED_PASSWORD_CHLOE`, `SEED_PASSWORD_DEV`, one per account); they are hashed into the database on each deploy and never stored in the repository.

Deploy (first time and every update), on the server:

```sh
git pull
docker compose -f compose.prod.yaml up -d --build
curl -fsS https://$PUBLIC_HOSTNAME/api/health
```

Migrations and the user seed run in the `migrate` service before the app starts; if a migration fails, Compose stops and the new app is not started. Check the certificate right after the first deploy (`docker compose -f compose.prod.yaml logs caddy`), since Let's Encrypt rate-limits repeated failures.

### CI/CD (GitHub Actions)

- `.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, typecheck, tests against a `postgres:17-alpine` service container, and a `docker build` of the `runner` target (not pushed). There is no lint script yet; the lint step turns on once an `eslint.config.*` exists. CI needs no secrets.
- `.github/workflows/deploy.yml` runs when CI succeeds on a push to `main` (the deploy branch): it pushes the image to GHCR as `ghcr.io/hamzawaqar82/sift:<commit sha>` and `:latest`, then SSHes to the server, runs `git pull && docker compose -f compose.prod.yaml up -d --build`, and fails unless `https://$PUBLIC_HOSTNAME/api/health` returns 200. CI never reads or writes the server's `.env`.
- Set these in a GitHub environment named `production` (Settings -> Environments):
  - Secrets: `DEPLOY_SSH_KEY` (private key of a dedicated deploy key pair; its public key in the server user's `~/.ssh/authorized_keys`), `DEPLOY_HOST` (Elastic IP), optional `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan <host>`; without it the host key is trusted on first use).
  - Variables: `PUBLIC_HOSTNAME` (e.g. `sift-43-204-61-13.sslip.io`), optional `DEPLOY_USER` (default `ubuntu`), optional `DEPLOY_PATH` (repo checkout on the server, default `sift`).
- No auto-rollback: if the health check fails the job goes red and the site keeps whatever state Compose left. Roll back by redeploying an earlier commit (revert on `main` and push, or on the server `git checkout <sha> && docker compose -f compose.prod.yaml up -d --build`).
- Next step: the server still builds images itself; switch `compose.prod.yaml` to `image: ghcr.io/hamzawaqar82/sift:<sha>` and `docker compose pull` so the tested image is the one that runs. In production, SSM Run Command with GitHub OIDC replaces SSH (see below).

## Production path

What this deployment does by hand, and what a production setup would do instead:

- **Deploys via SSM with OIDC, not SSH.** CI (e.g. GitHub Actions) assumes an IAM role through OIDC (no long-lived AWS keys) and runs the deploy with SSM Run Command (`AWS-RunShellScript`). Port 22 is closed and no SSH key exists to leak; every deploy is logged in CloudTrail. A failed health check after deploy would roll back to the previous image tag.
- **Secrets in a secrets manager.** `WEBHOOK_SECRET`, `SESSION_SECRET`, `GEMINI_API_KEY` and the database password live in AWS Secrets Manager (or SSM Parameter Store SecureString), read at start-up by the instance role, instead of a `.env` file on disk. Rotation becomes a secret update plus restart.
- **Managed database.** Postgres moves to RDS (Multi-AZ, automated backups, point-in-time restore, encryption at rest) in a private subnet reachable only from the app's security group. The `migrate` step runs unchanged against it.
- Also: images built once in CI and pushed to ECR (the server stops building), a paid Gemini key, real email delivery (SES) and the atomic AI-cap fix.
