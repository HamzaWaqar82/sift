# Sift: production upgrade

**Status:** ready-for-agent

Source material: `sift-production-prd.md` (outside the repo), refined by a grilling session on 2026-11-01. Where the two disagree, this spec wins. The PRD's phased delivery plan is not used; work is cut into vertical slices instead.

## Problem Statement

Sift works as a triage tool, but a real support team can't run on it yet.

- **Identity is demo-grade.** Five seeded accounts sign in with a signed cookie that stays valid for 7 days and can't be revoked. There is no way to add a teammate, reset a forgotten password, or lock out someone who has left. The sign-in rate limit lives in memory and resets whenever the app restarts.
- **Replies never reach the customer.** An agent writes and "sends" a reply, but it is only stored in the database. Customers don't receive anything, and when a customer writes back, their email becomes a brand-new, disconnected ticket.
- **Anyone can answer anything.** With four agents in one shared inbox, two people can reply to the same customer, and nobody is clearly responsible for a ticket.
- **Nothing says a customer has been waiting too long.** A ticket that has been unanswered for two days looks the same as one that arrived a minute ago.
- **The queue is stale.** New tickets only appear after a manual refresh.
- **AI triage is manual, and its free-tier limits are invisible.** The Gemini free tier has per-minute and per-day limits. Today the app only tracks a daily cap, and a rate-limit error is stored as an opaque failure on the ticket.
- **The UI is content-heavy.** It has more decorative and explanatory text than an agent needs at a glance, and there is no favicon.
- **Every push to `main` deploys straight to production**, with no staging environment.

There are also constraints: no domain and no budget for paid mail services, and the Gemini key is on the free tier.

## Solution

A real five-person team can run Sift, with no domain, no AWS mail setup and no paid services.

- **Accounts.** Teammates join by invitation only. An admin invites an email address with a role, and the invitee sets their name and password from the link in that email. Accepting the invite proves they control the inbox, so there is no second "verify your email" step. Sessions are stored in the database, so they can be listed and revoked. Deactivating a user or changing their role signs them out everywhere immediately. Forgotten passwords are reset by email, and changing an email address only takes effect once the new address is confirmed.
- **Real mail through a dedicated Gmail account.** Replies are delivered over Gmail SMTP. Customer replies are read from that inbox over IMAP IDLE (near-instant) and threaded into the existing ticket. Bounces are detected and shown, and the address is suppressed. Each reply shows an honest state: *Sending…*, *Sent ✓*, *Failed — Retry* or *Bounced*.
- **Hybrid ownership.** Everyone sees every ticket (the shared inbox survives), but only the ticket's owner can send. New tickets are auto-assigned to the available agent with the fewest open tickets. Owners can release a ticket to the pool, and anyone can claim from the pool. An auto-assigned ticket nobody opens within 4 hours moves on to the next agent, and a ticket whose customer has waited 24 hours is released to the pool for anyone to claim. Agents set themselves Available or Away. Internal notes let teammates help without taking over the send button.
- **Overdue marker.** Any ticket whose latest customer message has gone 24 hours without a delivered reply shows an *Overdue* badge with its age. Overdue tickets can also be filtered and counted.
- **Live updates.** New tickets, assignments, customer replies and releases appear within about a second. If the live stream is unavailable, the app quietly falls back to polling.
- **AI triage that respects the free tier.** Every new ticket is triaged automatically in the background. A single budget enforces both the per-minute and per-day limits. Agent clicks go ahead of automatic triage, rate-limit errors are retried visibly instead of failing silently, and a header chip shows the budget to everyone.
- **A lighter UI and a favicon**, keeping Sift's existing visual identity.
- **A safe release path.** Each slice is built in its own worktree and merged into a protected `staging` branch after CI passes. Staging deploys to its own environment and Playwright smoke tests run against it. Production only changes through a `staging → main` PR, and the production deploy waits for the owner's approval.

## User Stories

### Invitations and onboarding

1. As an admin, I want to invite a teammate by email with a role, so that only the people I choose can get in.
2. As an admin, I want the invite form to show the address back to me before sending, so that a typo doesn't send an invite to a stranger.
3. As an admin, I want to see pending, accepted, expired and revoked invites, so that I know who still has to join.
4. As an admin, I want to resend an invite, so that someone who lost the email can still join.
5. As an admin, I want to revoke an invite, so that a mistaken or outdated invite can't be used.
6. As an invitee, I want to open the link, set my name and password, and be signed in, so that joining takes one step.
7. As an invitee, I want a clear message when my link is expired, already used or revoked, so that I know to ask for a new one.
8. As the team owner, I want invite links to expire after 7 days and work only once, so that an old email can't be used to get in.
9. As the team owner, I want invite tokens stored only as hashes, so that a database leak doesn't expose usable links.
10. As the team owner, I want accepting an invite to count as email verification, so that teammates aren't asked to verify the same inbox twice.

### Sign-in, sessions and recovery

11. As a user, I want to sign in with my email and password, so that I can reach the queue.
12. As a user, I want my session to last up to 7 days, so that I'm not asked to sign in all the time.
13. As a user, I want to sign out everywhere, so that a lost laptop doesn't keep access.
14. As a user, I want to request a password reset by email, so that a forgotten password doesn't need an admin.
15. As the team owner, I want reset links to expire after 1 hour and work only once, so that an old email can't be replayed.
16. As the team owner, I want sign-in, reset and invite acceptance to give the same response whether or not an address exists, so that nobody can discover which emails have accounts.
17. As the team owner, I want failed sign-ins limited per IP address and per email, and those limits kept in the database, so that restarting the app doesn't reset an attacker's budget.
18. As the team owner, I want password-reset and invite-accept attempts rate-limited, with a `Retry-After` on rejection, so that those endpoints can't be abused.
19. As a user, I want to change my email address, with the change applying only after the new address confirms it, so that a typo can't lock me out.
20. As the five existing seeded staff, I want my current password to keep working after the upgrade, so that nobody is locked out on cutover.

### Admin user management

21. As an admin, I want to list all users with their role, availability and status, so that I can see the team at a glance.
22. As an admin, I want to change a user's role, which signs them out everywhere, so that a demoted admin can't keep admin rights in an old session.
23. As an admin, I want to deactivate a user rather than delete them, so that their history stays intact.
24. As an admin, I want deactivation to revoke all of that user's sessions, set them Away, and release their open tickets to the pool, so that leaving doesn't strand customers.
25. As an admin, I want an audit log of sign-in failures, invites, role changes, deactivations, password resets, email changes, session revocations and ticket ownership changes, so that I can answer "who did what".

### Outbound mail

26. As an agent, I want my reply delivered to the customer's real inbox, so that "Sent" means the customer received it.
27. As an agent, I want the reply to show *Sending…* until Gmail accepts it, then *Sent ✓*, so that I never believe something went out when it didn't.
28. As an agent, I want a failed send retried automatically with backoff, and shown as *Failed — Retry* once retries run out, so that a brief outage doesn't lose a reply.
29. As an agent, I want to retry a failed reply manually, so that I can recover once the problem is fixed.
30. As a customer, I want the reply to arrive in the same conversation in my mail client, so that the history stays together.
31. As a customer, I want the reply to come from "Sift Support", so that I recognise who wrote to me.
32. As an agent, I want a bounced reply marked *Bounced* with a warning on the ticket, so that I know the customer didn't receive it.
33. As the team owner, I want bounced addresses added to a suppression list, so that we stop sending to dead mailboxes.
34. As an agent, I want a send to a suppressed address blocked with a clear message, so that I don't silently send into a void.
35. As the team owner, I want a double click or a second tab to never produce two emails, so that customers don't get duplicates.
36. As the team owner, I want production to refuse to start with a non-real mail transport, so that a configuration mistake can't silently swallow replies.

### Inbound mail and threading

37. As the support team, I want emails sent to the support Gmail address to become tickets within seconds, so that customers can just email us.
38. As an agent, I want a customer's reply to land in the existing ticket's conversation, so that I see the whole history in one place.
39. As an agent, I want a ticket that was replied to or closed to reopen when the customer writes again, so that new questions aren't missed.
40. As an agent, I want the same email delivered twice to create only one message, so that retries and re-reads never duplicate anything.
41. As an agent, I want a reply that comes without threading headers matched by subject and sender within 30 days, so that replies from clients that drop headers still land in the right ticket.
42. As an agent, I want an AI draft marked *Out of date — regenerate* when the customer writes again, so that I don't send a reply to a question they've moved past.
43. As the team owner, I want a customer reply not to trigger a new AI call automatically, so that long threads don't burn the budget.
44. As an agent, I want a note that an attachment wasn't imported whenever an inbound email had one, so that nothing is silently dropped.
45. As the team owner, I want bounce notices kept out of the ticket queue, so that mailer-daemon messages never become tickets.
46. As an agent, I want search to cover every message in a thread, not just the first, so that I can find a ticket by anything the customer said.
47. As a developer, I want the existing JSON webhook kept for dev and tests, so that I can create inbound tickets without a mailbox.

### Ownership and routing

48. As an agent, I want to see every ticket in the team, not just my own, so that the shared inbox stays shared.
49. As an agent, I want a *Mine* view by default, so that I start with my own work.
50. As an agent, I want a *Needs an owner* view listing unassigned tickets with overdue ones first, so that I can pick up what's stuck.
51. As the support team, I want new tickets auto-assigned to the available agent with the fewest open tickets, ties going to whoever was assigned least recently, so that work spreads evenly without anyone routing it by hand.
52. As the support team, I want a ticket left in the pool when nobody is available, so that it waits visibly instead of going to someone who's away.
53. As an agent, I want to set myself Available or Away, so that I stop receiving new tickets when I step out.
54. As an agent who is Away, I want to keep working on tickets I already own, so that stepping out doesn't take my work away.
55. As an agent, I want to see who on the team is Available, so that I know who's around.
56. As an admin, I want to set anyone Away, so that I can stop routing to someone who forgot.
57. As an agent, I want to claim an unassigned ticket in one click, with a clear message if someone beat me to it, so that two people never own the same ticket.
58. As an owner, I want to release my ticket to the pool with an optional reason, so that I can hand off work when I'm swamped.
59. As the support team, I want an auto-assigned ticket nobody has opened within 4 hours to move to the next available agent, so that a dead laptop doesn't hold a customer hostage.
60. As the support team, I want a ticket released to the pool when its customer has waited 24 hours, so that the customer stops depending on one person.
61. As an agent, I want a released ticket to say who it was released from and why, so that I know its history.
62. As an admin, I want to reassign any ticket to a specific person, so that I can balance work by hand.
63. As a non-owner, I want the Send button replaced with "Owned by <name>", so that I know why I can't reply.
64. As the team owner, I want a non-owner's send rejected by the server even if the UI is bypassed, so that ownership can't be dodged.
65. As an owner, I want my send rejected if a new message arrived after I opened the composer, with options to review it or reload, so that I never reply blindly.

### Internal notes

66. As any agent, I want to add an internal note to any ticket, so that I can help a teammate without taking their ticket.
67. As an agent, I want notes shown in the conversation, clearly styled as internal, so that I can't confuse them with customer mail.
68. As the team owner, I want notes never emailed and never sent to the AI, so that staff-only context stays private.

### Overdue

69. As an agent, I want an *Overdue 1d 4h* badge on any ticket whose latest customer message has gone 24 hours without a delivered reply, so that I can see who's been waiting longest.
70. As an agent, I want the badge in the inbox, table and board views, so that I see it whichever view I use.
71. As an agent, I want to filter to overdue tickets with a removable chip that combines with other filters, so that I can work through a backlog.
72. As an agent, I want an overdue count in the header, so that I know how much is waiting without filtering.
73. As the team owner, I want a queued, failed or bounced reply not to clear the overdue marker, so that it reflects whether the customer actually heard back.
74. As the team owner, I want a new customer message to restart the clock, so that overdue reflects the latest wait.
75. As the team owner, I want closed tickets never marked overdue, so that the count stays honest.
76. As the team owner, I want the threshold set in configuration, so that the 24-hour policy can change without code.

### Live updates

77. As an agent, I want new tickets to appear in my list without refreshing, so that I see work as it arrives.
78. As an agent, I want a toast when a ticket is assigned to me, so that I notice new work.
79. As an agent, I want ticket status, owner, triage state and overdue to update in place, so that the list stays accurate.
80. As an agent, I want a ticket I'm viewing to show "<name> just replied" when someone else replies, so that I don't duplicate their work.
81. As an agent, I want a quiet "Live updates paused" chip with automatic polling when the live connection fails, so that the app keeps working without it.
82. As the team owner, I want a reply I'm writing never changed under me by a live update, so that my text is never lost.

### AI triage and budget

83. As an agent, I want every new ticket triaged automatically in the background, so that the category, urgency and draft are ready when I open it.
84. As the support team, I want a new ticket saved and assigned even when Gemini is slow or down, so that AI problems never lose tickets.
85. As the team owner, I want every Gemini call to pass a per-minute and per-day budget first, so that automatic triage can't exhaust the free tier.
86. As an agent, I want my manual Triage click to go ahead of queued automatic triage, so that the person waiting is served first.
87. As the team owner, I want automatic triage capped at about 80% of the daily budget, with the rest kept for manual clicks, so that agents can still triage by hand on a busy day.
88. As an agent, I want each ticket to show its triage state (Queued, Triaging…, Triaged, Waiting on AI limit with a retry time, Daily AI limit reached, or Failed — Retry), so that I never wonder why there's no draft.
89. As the team owner, I want a Gemini rate-limit error requeued with backoff, never stored as a silent failure, so that a burst of tickets just takes a little longer.
90. As anyone on the team, I want a header chip showing AI use today and the number queued, turning amber near the limit, so that the budget is visible.
91. As an admin, I want a detail view of recent AI calls, rate-limit errors, the triage queue and failed jobs, so that I can diagnose problems.

### Permissions

92. As the team owner, I want every capability in the permission matrix enforced on the server and covered by a test, so that authorization can't drift.
93. As an agent, I want to close only my own tickets, and only after a sent reply, so that tickets aren't closed without an answer.
94. As an agent, I want to reopen any ticket, so that I can bring back a question that wasn't actually resolved.

### UI and identity

95. As an agent, I want a less text-heavy interface that keeps Sift's look, so that I can scan the queue faster.
96. As a user, I want a Sift favicon in my browser tab, so that I can find the tab among many.

### Release and operations

97. As the owner, I want nothing to reach production except through a `staging → main` PR and my approval of the deploy, so that production is never changed by accident.
98. As the owner, I want every change deployed to a staging environment first, with Playwright smoke tests run against it, so that problems show up before production.
99. As the owner, I want staging never to email real customers, so that testing can't spam anyone.
100. As the owner, I want a background worker that survives app restarts and shows failed jobs to admins, so that background work never disappears.
101. As the owner, I want the health check to report the database, worker and mail connection, so that a broken deploy is obvious.
102. As a reviewer, I want `docker compose up` to run the whole system with capture mail and no Google account, so that I can try it offline.

## Implementation Decisions

### Release pipeline

- **Branches.** `main` and `staging` are protected: changes only through PRs, required checks "Typecheck and test" and "Docker build (runner target)", branch must be up to date, rules apply to admins, no force-push, no deletion. This is already applied.
- **Approval gate.** The GitHub `production` environment requires the owner's approval. It replaces PR approvals, because the owner is the only account and can't approve their own PRs.
- **Flow.** Each slice is built in a git worktree on `feat/<slice>` and opened as a PR into `staging`. The agent merges once CI is green. A staging deploy workflow runs on each push to `staging`, then the Playwright smoke suite runs against staging. The owner opens or approves `staging → main` and approves the production deploy.
- **Staging environment.** It lives on the same EC2 host as production: a separate Compose project with its own Postgres volume, its own `.env`, and the hostname `sift-staging-43-204-61-13.sslip.io`, behind the same Caddy.
- **Production guard.** Deploys from `main` only, as today.

### Identity (Better Auth)

- Better Auth with the Drizzle adapter on Postgres. Identity lives in Sift's own database.
- **Spike first.** The first slice is a time-boxed spike (about 2 hours) to map Better Auth's user model onto the existing integer-id `users` table. If that doesn't work, fall back to a separate auth user table with a text id, linked one-to-one to `users`. The spike's outcome gets recorded in this spec.
- Better Auth owns the `account`, `session` and `verification` tables. Sessions are database rows: 7-day absolute expiry, httpOnly, Secure in production, SameSite=Lax.
- The existing route guards (`requireUser`, `requireAdmin`, `requirePageUser`) keep their call signatures but resolve against the session table. Route handlers stay one-line guard calls.
- **Revocation** happens on deactivation, role change, email change, and "sign out everywhere".
- **Invitations.** A new `invitations` table: email, role, token hash, invited by, expires at (7 days), accepted at, revoked at. The plaintext token exists only inside the emailed link. Accepting creates the user with `email_verified = true`.
- **Email verification.** The invite counts as verification. Email changes require confirmation from the new address, and password reset tokens are single-use and expire after 1 hour.
- **Rate limits.** A `rate_limits` table (key, window start, count) replaces the in-memory limiter:
  - sign-in: 5 failures per 15 min, per IP and per email
  - password reset: 3 per hour per email and 10 per hour per IP
  - invite send: 20 per day per admin
  - invite accept: 10 per hour per IP

  Rejections return 429 with `Retry-After`.
- **Users.** `users` gains `email_verified`, `availability` (available/away), `deactivated_at` and `last_assigned_at`. The existing bcrypt hashes move into `account` and keep working.
- **Audit log.** An `audit_log` table: actor (null means system), action, ticket, target user, metadata as jsonb, created at.

### Mail

- **One `Mailer` interface, `send(message) → providerMessageId`, with adapters chosen by `MAIL_TRANSPORT`:**
  - `gmail`: a dedicated Gmail account with 2-Step Verification and an app password, sending through SMTP (`smtp.gmail.com`) with nodemailer. Used in production only.
  - `capture`: writes the fully rendered email to a `dev_mailbox` table, viewable at `/dev/mailbox`. Used in dev and staging. On staging, real sends are optionally allowed through a second test Gmail account, but only to addresses on `MAIL_ALLOWED_RECIPIENTS`; everything else is captured.
  - `fake`: an in-memory recorder for tests.
- **Production guard.** Startup fails in production if `MAIL_TRANSPORT` isn't `gmail`, or if the Gmail credentials are missing.
- **Fallback.** If Google withdraws app passwords, the `gmail` adapter switches to OAuth2 (XOAUTH2) over the same SMTP/IMAP connections. Nothing else changes.
- **Rejected.** SES, Resend, SendGrid and Brevo were rejected because each needs a domain for real delivery or receiving, and SendGrid has no free tier. Any of them can become an adapter if a domain is acquired.
- **Headers.** `From: "Sift Support" <the Gmail address>`, a generated `Message-ID`, and `In-Reply-To`/`References` pointing to the latest inbound message.
- **Message-ID spike.** The mail slice checks whether Gmail SMTP keeps our generated `Message-ID`. If it doesn't, the adapter reads back the real one from the Sent folder over IMAP, and that becomes the stored message id.
- **Sending is queued.** Sending inserts an outbound message with status `queued` and an idempotency key, then enqueues a `mail.send` job. The job retries with backoff (10s, 1m, 5m, 30m, 2h), up to 5 attempts, then marks the message `failed` with the last error.
- **Statuses.** Message states are `queued`, `sending`, `sent`, `failed`, `bounced`. "Sent" means Gmail accepted it. The ticket becomes `replied` and `last_outbound_at` is set only when the message reaches `sent`.
- **Stale composer.** The send transaction refuses to insert if the ticket's latest message changed since the composer loaded. It responds `409 stale_ticket`, in addition to the existing idempotency key.
- **Suppression.** A `suppressed_emails` table (email, reason, created at). Sending to a suppressed address is rejected with a clear error.
- **Inbound pipeline.**
  - The worker keeps one IMAP connection (`imapflow`) to `imap.gmail.com` in IDLE mode, with a 60-second poll as fallback. It tracks the last processed UID.
  - Every raw message goes through a single function, `ingestInboundEmail(rawMime)`. It parses with `mailparser` and dedupes on `Message-ID` (unique index).
  - Bounce notices from mailer-daemon are recognised and matched to the original outbound message. That message becomes `bounced` and the address is suppressed; bounces never become tickets.
  - Otherwise the thread is matched in this order: `In-Reply-To`/`References`, then normalised subject plus the same sender within 30 days, then a new ticket.
  - A matched reply is appended to the ticket, reopens a replied or closed ticket, keeps the owner, sets `last_inbound_at`, and marks the current triage draft as superseded. It does not call the AI again.
  - Attachments aren't imported, but each one is noted in the message.
- **Dev webhook.** The existing JSON webhook stays as a dev/test route into the same ingest path. It is refused in production.

### Data model

- **`messages`** replaces `tickets.body` and `replies`. Columns: ticket, direction (inbound/outbound), author user (null when inbound), from, to, subject, body text, body html, message id (unique, nullable for legacy rows), in reply to, references, occurred at, status, attempts, last error, provider message id, AI draft, edited, idempotency key (unique, nullable).
- **Migration.** `tickets.body` becomes the first inbound message. `replies` become sent outbound messages. Ticket timestamps are back-filled. `tickets.body` and `replies` are dropped only after the threading slice is green on staging.
- **`tickets` gains** `assigned_by` (auto/admin/claim/system), `released_from_user_id`, `release_reason`, `first_opened_at`, `last_inbound_at`, `last_outbound_at`, `overdue_since`.
- **New tables:** `jobs` (kind, payload, priority, run at, attempts, locked at, last error, status), `internal_notes` (ticket, author, body, created at), and the auth, mail and rate-limit tables above.
- **Search** covers all messages of a ticket through an `EXISTS` subquery.
- **Rehearsal.** Migrations run against a copy of the production database on staging before they reach production. Production data is demo data.

### Background work

- A worker runs as its own Compose service from the same image and shares the database. It runs a single instance.
- Jobs are claimed with `FOR UPDATE SKIP LOCKED`, ordered by priority, then `run_at`. A stale `locked_at` gets recovered. Retries are bounded, and exhausted jobs are marked `failed` and shown to admins.
- **Job kinds:** `triage.auto`, `triage.manual`, `mail.send`, `assign.ack_timeout`, `ticket.overdue_sweep`.
- The worker also owns the IMAP connection.
- **One entry point for tests.** A single function, `runDueJobs()`, processes everything currently due exactly once. The worker loop calls it repeatedly; tests call it directly.

### Ownership and routing

- **Auto-assignment** runs when a ticket is created (webhook, form or inbound email) and when a pooled ticket gets a customer reply.
  - It picks from active, available agents and admins, ordered by open-ticket count ascending, then `last_assigned_at` ascending (nulls first), in one transaction.
  - If there are no candidates, the ticket stays in the pool.
- **Claim** is a conditional update that only succeeds while the ticket has no owner. If zero rows change, the response is `409 already_claimed`.
- **Release.** The owner or an admin can release a ticket. It clears the owner and records `released_from_user_id` and the reason. A non-empty reason is also posted as an internal note.
- **Ack timeout.** An auto-assigned ticket with no `first_opened_at` after `ACK_TIMEOUT_MINUTES` (default 240) moves to the next candidate, or to the pool if there is none. `first_opened_at` is set the first time the owner opens the ticket.
- **Overdue sweep** runs every 5 minutes. A ticket qualifies when it isn't closed, its latest inbound message is newer than its latest sent outbound, and that inbound message is at least `OVERDUE_HOURS` old (default 24). Qualifying tickets get `overdue_since` set, are released to the pool with `assigned_by = system`, are audited, and an event is published.
- **Reassignment.** Admin reassignment keeps its existing endpoint, now with an audit row and an event.
- **Away status.** Away is a manual toggle. Away agents are excluded from new assignments but keep the tickets they already own. Deactivated users count as away.
- **Existing tickets at cutover** keep their assignees. Unassigned open tickets go to the pool and are not bulk-assigned.

### Overdue

- A ticket is overdue when it isn't closed, its latest inbound message has no later outbound message in status `sent`, and that inbound message is at least `OVERDUE_HOURS` old.
- The overdue state is computed at query time for display, so the badge is accurate between sweeps. `overdue_since` drives the release.
- **Display.** A badge before the subject in the inbox, table and board views. An `overdue=1` list filter with a removable chip. An overdue count in the header, in an orange tone, because red is reserved for high urgency and Send. A banner on the ticket detail naming who it was released from.

### Live updates

- An authenticated SSE route at `/api/events`.
- The app publishes with Postgres `NOTIFY sift_events`. One dedicated `LISTEN` connection per app instance fans events out to all subscribers in that process; there is a single instance.
- **Events:** `ticket.created`, `ticket.updated`, `ticket.assigned`, `ticket.released`, `message.created`, `message.status_changed`, `note.created`, `triage.updated`, `overdue.marked`, `ai_budget.updated`.
- **Event payloads** carry ids and small facts. Clients refetch what they display. Event data carries no customer text.
- **Keepalive.** A heartbeat comment every 20 seconds, and the `X-Accel-Buffering: no` header. Caddy is configured not to buffer this route.
- **Client.**
  - New tickets are prepended to the list and the counts are updated. A toast appears only when the ticket is assigned to me.
  - Ticket rows are patched in place.
  - An open reply composer is never modified.
  - A ticket being viewed shows a "<name> just replied" notice.
  - After 3 failed connections, the client polls every 20 seconds and shows a "Live updates paused" chip.

### AI triage and budget

- **Automatic triage.** A ticket's creation enqueues `triage.auto` after the ticket is saved and assigned. The API responds immediately. Customer replies do not re-triage.
- **Manual triage.** A manual Triage click enqueues `triage.manual` at higher priority. The UI waits for the result through events, or a short poll as fallback.
- **One budget gate.** Every Gemini call goes through a single database-backed limiter enforcing `AI_RPM_LIMIT` (per minute) and `AI_DAILY_CAP` (per UTC day, existing). Automatic jobs may only use `100 − AI_MANUAL_RESERVE_PCT` percent of the daily cap (default reserve 20%). All limits come from configuration, set just below the live AI Studio quota.
- **Rate-limit errors.** A Gemini 429, or a refusal from our own limiter, requeues the job with backoff, honouring `Retry-After`. It is never stored as a failed triage. Only real errors (invalid output, provider errors after retries) become `Failed — Retry`.
- **Triage states per ticket:** `queued`, `running`, `done`, `waiting_rate_limit` (with retry time), `daily_cap_reached`, `failed`, `superseded`.
- **Budget chip.** The header chip reads, for example, `AI 37/50 today · 3 queued`. It turns amber at 80% and shows "paused until HH:MM" while the minute limit is hit.
- **Admin AI panel.** Shows recent calls, 429s, queue depth and failed jobs.
- **Unchanged.** Redaction, prompt delimiting, the strict output schema and "a human sends every reply" stay as they are.

### Permission matrix (enforced server-side; every row tested)

| Capability | Owner | Other agent | Unassigned | Admin |
|---|---|---|---|---|
| View any ticket, thread, notes, triage | ✅ | ✅ | ✅ | ✅ |
| Request triage | ✅ | ❌ | ❌ (claim first) | ✅ |
| Regenerate triage | ❌ | ❌ | ❌ | ✅ |
| Send reply | ✅ | ❌ `403 not_ticket_owner` | ❌ `409 ticket_unassigned` | ✅ |
| Retry failed reply | ✅ | ❌ | — | ✅ |
| Add internal note | ✅ | ✅ | ✅ | ✅ |
| Claim | — | ✅ (atomic) | ✅ | ✅ |
| Release to pool | ✅ | ❌ | — | ✅ |
| Reassign to a person | ❌ | ❌ | ❌ | ✅ |
| Set own availability | ✅ | ✅ | — | ✅ |
| Set anyone's availability | ❌ | ❌ | — | ✅ |
| Close | ✅ (after a sent reply) | ❌ | ❌ | ✅ any |
| Reopen | ✅ | ✅ | ✅ | ✅ |
| Create ticket from form | ✅ | ✅ | — | ✅ |
| Invite / revoke invite / deactivate / change role | ❌ | ❌ | — | ✅ |
| View audit log, AI panel, failed jobs | ❌ | ❌ | — | ✅ |

### UI

- An `impeccable` distill pass after the feature slices land. It removes decorative and duplicated text and keeps the established identity documented in DESIGN.md. Trim moderately, not aggressively.
- The `DirectionContract` scaffold is removed.
- A favicon derived from the existing logomark, served at 16, 32 and 180 px through the App Router's icon conventions.

### Configuration

- New settings: `MAIL_TRANSPORT`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM_NAME`, `MAIL_ALLOWED_RECIPIENTS`, `APP_BASE_URL`, `INVITE_TTL_HOURS`, `ACK_TIMEOUT_MINUTES`, `OVERDUE_HOURS`, `AI_RPM_LIMIT`, `AI_MANUAL_RESERVE_PCT`, plus Better Auth's secret.
- Startup fails fast on any missing production value, using the existing Compose pattern.

### Security

- State-changing routes are POST, origin-checked and session-authenticated, with role checks on the server only.
- Tokens are hashed at rest, single-use, expire, and are never logged.
- No email enumeration.
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`, and a conservative CSP. Caddy keeps HSTS.

## Testing Decisions

- **What makes a good test.** Exercise behaviour through the highest seam and assert what a caller or user can observe: status codes, response bodies, database rows, emails handed to the mailer, published events. Don't assert internal function calls. Every 403 and 409 in the permission matrix is a first-class test.
- **Seam 1 (main, existing): route handlers called in-process against real Postgres.** Tests import a route's handlers and call them with real `Request` objects and a session cookie, exactly like the existing tests for replies, reassignment, close and the webhook. The sign-in helper changes to sign in through Better Auth's real endpoint. This seam covers auth, invites, reset, rate limits, permissions, claim, release, availability, overdue filters and counts, sends, stale-composer 409s, notes and the AI budget.
- **Seam 2: the `Mailer` adapter.** Tests use the `fake` adapter. They assert recipients, From, `Message-ID`, `In-Reply-To`/`References`, and that suppressed addresses are never sent to. They also make it throw to exercise retries and the `failed` state.
- **Seam 3: `ingestInboundEmail(rawMime)`.** It is fed `.eml` fixtures committed to the test folder: a new email, a reply with headers, a reply without headers (subject fallback), a duplicate, a mailer-daemon bounce, and an email with an attachment.
- **Seam 4: `runDueJobs()`.** Tests enqueue work or age the database timestamps, call it once, and assert the outcome. This covers mail sending and backoff, automatic and manual triage ordering, the 4h ack timeout, and the overdue sweep. Time is controlled by moving timestamps into the past, not by faking the clock.
- **Existing seam: `runTriageModel`.** It stays mocked as today. It is made to return 429s to test requeueing, the reserve and the triage states.
- **Seam 5: the event bus.** Tests subscribe in-process, perform an action through a route, and assert that the event arrives with the expected payload.
- **Concurrency.** Two concurrent claims result in exactly one owner. Two concurrent sends with the same idempotency key produce one message.
- **Migration test.** Seed old-shape data, run the migrations, and assert the messages, accounts and timestamps.
- **Prior art.** Existing tests for replies, reassignment, close, the webhook, triage, triage hardening and the list API. The global setup that creates and migrates the test database.
- **Playwright smoke suite.** Runs against the deployed staging URL after each staging deploy, not on PRs. It covers:
  - sign in
  - invite a user and accept the invite through `/dev/mailbox`
  - sign out and back in
  - create a ticket from the form and see it auto-assigned
  - triage reaches a terminal state
  - send a reply and see it in `/dev/mailbox`
  - post to the inbound webhook and see the ticket appear live
  - see the overdue badge on a seeded aged ticket
  - claim from *Needs an owner*
- **Production post-deploy check.** The health check plus a read-only smoke test.
- **Not tested automatically.** Real Gmail SMTP and IMAP, and SSE through Caddy. These are verified manually on staging, with the second test Gmail account and the recipient allowlist, before the first production promotion of the mail slice.
- **No test touches the network.**

## Out of Scope

- Owning a domain. SES, Resend, SendGrid or any other paid or domain-bound mail provider (adapters can be added later).
- Public sign-up, multi-tenancy, workspaces, billing.
- SMS, push notifications, mobile apps, i18n, dark mode.
- Importing attachments (they are noted on the message, not stored).
- Automated sending of any kind. A human sends every reply.
- RAG or embedding retrieval for help articles.
- Multiple app instances, Redis, Kubernetes, a shared event broker.
- Automatic idle detection for availability.
- Gmail API, Pub/Sub push or OAuth app verification. These were rejected for inbound mail: restricted scopes, refresh tokens that expire after 7 days in testing mode, and a watch subscription that needs renewing.
- Bulk reassignment of existing unassigned tickets at cutover.

## Further Notes

- **Gmail limits.** About 500 recipients per rolling 24 hours, and 15 simultaneous IMAP connections per account (the worker uses one). The From address is visibly `@gmail.com`; only the display name can be set.
- **App passwords.** Google discourages them but they still work for personal accounts. The XOAUTH2 fallback keeps the adapter's interface stable if that changes.
- **Gemini limits.** Free-tier limits change often and vary by model. Read the live values from AI Studio and set `AI_RPM_LIMIT`/`AI_DAILY_CAP` slightly below them.
- **Automatic triage reverses a product principle.** It replaces the original "triage on demand only" rule. PRODUCT.md and the README must be updated to say so.
- **Suggested slice order** (to-tickets decides the final order):
  1. staging pipeline
  2. Better Auth spike
  3. capture mailer with `/dev/mailbox` and the jobs worker
  4. identity
  5. the `messages` cutover with outbound Gmail
  6. inbound IMAP and threading
  7. overdue marker
  8. live updates
  9. AI budget and automatic triage
  10. ownership and routing
  11. internal notes
  12. UI distill and favicon

  The user's original asks (auth, real mail, overdue, live updates, favicon, lighter UI) should become visible as early as dependencies allow.
- **Manual setup only the owner can do,** to be walked through with a wizard script when the mail slice needs it:
  - create the dedicated Gmail accounts (production and staging test)
  - enable 2-Step Verification
  - generate app passwords
  - put them in each server's `.env`
