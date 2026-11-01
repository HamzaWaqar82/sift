# Sift: 15-minute demo script

Live site: https://sift-43-204-61-13.sslip.io. Secrets are never typed on screen: load them from the untracked `.env.deploy` before you start.

## Before the demo (not on the clock)

```sh
cd sift                                   # repo root
set -a; . ./.env.deploy; set +a           # WEBHOOK_SECRET, SEED_PASSWORD_ADMIN, SEED_PASSWORD_ALICE, PUBLIC_HOSTNAME
BASE=https://$PUBLIC_HOSTNAME
curl -fsS $BASE/api/health                # {"status":"ok","db":"up"}
```

- Two browser windows: a normal one (agent `alice@sift.local`) and a private one (admin `admin@sift.local`). Passwords: `$SEED_PASSWORD_ALICE` / `$SEED_PASSWORD_ADMIN` (paste, do not show).
- State on prod: seeded tickets 1–14; pre-triaged **#1** (Charged twice, billing), **#7** (UNACCEPTABLE locked out), **#9** (prompt-injection attempt), and **#29** (export failing, triaged and already replied, from the smoke test). **#30** (add team member) exists but is untriaged. Ticket ids may differ; use the subjects.
- Budget: the live triage below is one Gemini call. If the provider is slow or failing, use a pre-triaged ticket and say so.

## 0:00–1:30 Problem and shape

- One sentence: a small support team gets email; Sift turns each email into a ticket, an agent asks for one AI triage (category, urgency, draft, help article), edits the draft and sends it. Nothing is sent automatically.
- Stack: Next.js + Postgres + Drizzle on one EC2 instance behind Caddy (HTTPS on sslip.io), Gemini for triage.

## 1:30–3:00 Sign-in and the inbox (agent window)

1. Open `$BASE` → redirected to **Sign in to Sift**. Sign in as `alice@sift.local` → **Sign in**.
2. **Tickets** list: newest first, 20 per page, status filter (All / open / replied / closed) in the URL. Point at the badges: #1, #7, #9 show category and urgency; the rest say **Not triaged yet** (triage runs on demand only, to keep spend proportional).
3. Click **New ticket**: the form for phone calls and chats (show the fields, do not submit).

## 3:00–5:00 Email arrives through the webhook (terminal)

Re-posting the live samples shows idempotency (they were posted during the smoke test):

```sh
for f in samples/live/01-export-failing-urgent.json samples/live/02-add-team-member.json; do
  curl -sS -w '  HTTP %{http_code}\n' -o /dev/null -X POST "$BASE/api/webhook" \
    -H "content-type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" --data-binary @"$f"
done                                      # HTTP 200 twice: same message id -> existing ticket, no duplicate
```

A genuinely new email (fresh message id) creates a ticket:

```sh
sed "s/-live-/-demo-$(date +%s)-/" samples/live/02-add-team-member.json | \
  curl -sS -w '  HTTP %{http_code}\n' -o /dev/null -X POST "$BASE/api/webhook" \
    -H "content-type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" --data-binary @-
                                          # HTTP 201
curl -sS -w '  HTTP %{http_code}\n' -o /dev/null -X POST "$BASE/api/webhook" \
  -H "content-type: application/json" -H "x-webhook-secret: wrong" --data-binary @samples/live/01-export-failing-urgent.json
                                          # HTTP 401: wrong secret
```

Refresh the browser: **How do I add a new team member?** is at the top, source `webhook`, **Not triaged yet**.

## 5:00–8:30 Live triage, review, send (agent window)

1. Open the new **How do I add a new team member?** ticket. Click **Triage with AI** (one Gemini call, about 2 s).
2. The **AI triage** panel shows category, urgency and **Suggested draft (review before sending)**. Beside the reply box, **Draft based on help article** shows the full article so the draft can be checked against its source.
3. The reply box is prefilled with the draft. Edit one sentence (e.g. add "Let me know if the invite email does not arrive."). Click **Send reply**.
4. The sent reply appears with sender (Alice Agent), time and an "edited" marker; the ticket status is now **replied**. Point out: AI draft and final text are both stored, edited is computed on the server, a double click records one reply, and no email actually leaves the app (SES left out).
5. Reload the page: the triage is cached; no new call.

## 8:30–10:00 Safety: prompt injection and failures

1. Open **Question about my subscription** (#9): the email tells the model to ignore its instructions. The pre-triaged result is an ordinary, harmless draft. The email goes into the prompt as untrusted data inside tags; the real control is that a human reviews every draft.
2. Mention, without demoing: invalid model output (bad JSON, invented article) is stored as an error with **Show raw AI output** and **Retry**, never shown as a draft; email addresses and phone numbers are redacted before the call; every call passes the AI budget (`AI_RPM_LIMIT` per minute, `AI_DAILY_CAP` per UTC day); at a limit the ticket shows "Waiting on AI limit" or "Daily AI limit reached" and the agent can write manually.

## 10:00–12:30 Roles: reassign (admin window + terminal)

1. In the private window sign in as `admin@sift.local`, open **Charged twice for October**: the **Reassign to** picker and **Regenerate (admin)** are visible. In the agent window the same page has neither.
2. Hidden UI is not security; show the server refuses the agent:

```sh
curl -s -o /dev/null -c agent.jar -H 'content-type: application/json' \
  -d "{\"email\":\"alice@sift.local\",\"password\":\"$SEED_PASSWORD_ALICE\"}" "$BASE/api/auth/sign-in/email"
curl -s -c admin.jar -o /dev/null -H 'content-type: application/json' \
  -d "{\"email\":\"admin@sift.local\",\"password\":\"$SEED_PASSWORD_ADMIN\"}" "$BASE/api/auth/sign-in/email"

curl -s -w '  HTTP %{http_code}\n' -b agent.jar -H 'content-type: application/json' \
  -d '{"assigneeId":4}' "$BASE/api/tickets/1/assign"     # 403 {"error":"You do not have permission to do that"}
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b admin.jar -H 'content-type: application/json' \
  -d '{"assigneeId":4}' "$BASE/api/tickets/1/assign"     # HTTP 200
rm -f agent.jar admin.jar
```

3. Refresh the admin window: assignee is now Chloe Agent (user ids: 1 admin, 2 alice, 3 ben, 4 chloe, 5 dev).

## 12:30–14:00 Deploy and production path

- Show `compose.prod.yaml` briefly: Caddy → app → Postgres, a `migrate` service that must finish before the app starts. Deploy is `git pull && docker compose -f compose.prod.yaml up -d --build` over SSH; `/api/health` checks the database.
- Production path (README): deploy with SSM Run Command from CI via OIDC (no SSH, no keys), secrets in Secrets Manager, Postgres on RDS, paid Gemini key.

## 14:00–15:00 Trade-offs and the known problem

- Left out: real email delivery, threading, claiming, retrieval for articles (all articles go in every prompt).
- Free-tier risk: on a free Gemini key prompts may be used by Google; redaction reduces, does not remove it.
- Known problem: the daily AI cap is check-then-increment, so simultaneous requests can overshoot it; fix is one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE calls < cap RETURNING` (README, "Known problem and fix").
- Questions.
