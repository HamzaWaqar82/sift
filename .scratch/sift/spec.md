# Sift: support inbox triage

**Status:** ready-for-agent

## Problem Statement

A support team of four people shares one inbox. Tickets are scattered across email, and every reply is written from scratch. Agents lose time reading and categorising each message, and a hurried reply can be wrong, off-policy or sent to the wrong person. The team needs one place where tickets arrive, can be triaged quickly, and where a reply is always reviewed by a human before it goes out. The AI key has a monthly spend cap, so AI use must be deliberate and cheap.

## Solution

Sift is a small web app with sign-in for two roles, agent and admin. Tickets arrive through a secured webhook (inbound email) or are created by an agent from a form. Agents work from a filterable, paged ticket list. When an agent opens a ticket they can request one AI triage, which returns a category, an urgency, a draft reply, and the help article the draft is based on. The result is checked against a strict shape before anything is shown; if it fails, the agent sees an error instead of a draft. The agent edits and sends the reply. Nothing is ever sent automatically, and every sent reply records who sent it, when, the AI draft, and the final text. Admins can reassign tickets; agents cannot. The app is deployed on AWS behind HTTPS and shipped by CI/CD.

## User Stories

### Sign-in and roles
1. As an agent, I want to sign in with my email and password, so that only my team can see customer tickets.
2. As an admin, I want to sign in with my own account, so that my elevated actions are attributable to me.
3. As any user, I want my session to persist securely across page loads, so that I do not have to sign in repeatedly.
4. As any user, I want to sign out, so that a shared computer does not expose tickets.
5. As an unauthenticated visitor, I want every page and API (except the webhook and health check) to reject me, so that customer data stays private.
6. As the team owner, I want repeated failed sign-ins from one address to be slowed down, so that known accounts on a public URL cannot be brute-forced.
7. As the team owner, I want the four agents and one admin to be seeded with passwords from configuration, so that there is no public sign-up surface.
8. As an agent, I want to see my name and role in the header, so that I know which permissions I have.

### Ticket intake
9. As the support team, I want inbound emails posted to a webhook to become tickets, so that they appear in one place.
10. As the team owner, I want the webhook to require a shared secret, so that strangers cannot create tickets or burn AI budget.
11. As the team owner, I want oversized webhook bodies to be rejected, so that the endpoint cannot be abused with huge payloads.
12. As the support team, I want a duplicate delivery of the same email to be ignored, so that retries never create duplicate tickets.
13. As the support team, I want every inbound email to create a new ticket, so that nothing is lost (threading follow-ups into existing tickets is out of scope).
14. As an agent, I want the customer's original message stored on the ticket, so that I can read the full text.
15. As an agent, I want to create a ticket from a form (customer email, subject, body), so that I can log a phone call or chat.
16. As an agent, I want form tickets to be marked with their source, so that I can tell them apart from emails.
17. As an agent, I want invalid form input to show clear field errors, so that I can fix it quickly.
18. As the support team, I want a malformed webhook payload to get a clear 4xx response, so that the email sender can detect and fix it.

### Ticket list
19. As an agent, I want to see all tickets newest first, so that I handle the freshest work first.
20. As an agent, I want to filter by status (open, replied, closed), so that I can focus on what needs action.
21. As an agent, I want to see who each ticket is assigned to in the list, so that I know who owns it.
22. As an agent, I want the list paged with a Next control, so that a large inbox stays fast.
23. As an agent, I want the filters and page position kept in the URL, so that I can bookmark and share a view.
24. As an agent, I want changing a filter to restart from the first page, so that I never land on an empty page by accident.
25. As an agent, I want each row to show subject, customer, status, assignee, source and age, so that I can scan quickly.
26. As an agent, I want a ticket that has been triaged to show its category and urgency in the list, so that I can prioritise; and for untriaged tickets I want to see a clear "not triaged yet" marker.
27. As an agent, I want an empty-state message when no tickets match, so that I know the filter worked.
28. As an agent, I want the list to stay stable when new tickets arrive between pages, so that I never see a ticket twice or skip one.

### Ticket detail and assignment
29. As an agent, I want to open a ticket and read the full message and conversation, so that I understand the issue.
30. As an agent, I want to see who a ticket is assigned to on its detail page, so that I know who owns it.
31. As an agent, I want the reassign control hidden and the action refused for me, so that ownership is controlled by admins.
32. As an admin, I want to reassign any ticket to any user, so that I can balance the workload.
33. As the team owner, I want the reassign rule enforced on the server, so that hiding a button is not the only protection.
34. As any agent, I want to be able to reply to any ticket regardless of owner, so that a team of four never blocks on ownership.
35. As an agent, I want to close a ticket, so that finished work leaves the open queue.

### AI triage
36. As an agent, I want to request triage when I open a ticket, so that I get a category, urgency and draft without writing from scratch.
37. As the team owner, I want triage to run only when a human asks for it and to be cached, so that no ticket costs money until someone looks at it and each ticket costs at most one call.
38. As an agent, I want the cached result shown on later visits, so that reopening a ticket is instant and free.
39. As an admin, I want to regenerate a triage, so that I can recover from a poor result.
40. As an agent, I do not want to be able to regenerate, so that spend stays controlled.
41. As the team owner, I want a daily cap on AI calls set in configuration, so that the monthly spend cap is not exhausted.
42. As an agent, I want a clear message when the daily cap is reached, so that I know to write the reply manually.
43. As an agent, I want the AI result validated against the expected shape (category, urgency, draft, article reference) before it is shown, so that malformed output never reaches a customer.
44. As an agent, I want an article reference that does not exist to be treated as a failure, so that the AI cannot invent sources.
45. As an agent, I want a failed or invalid result shown as an error, with the raw output available but collapsed, so that I can see what went wrong without it looking like a valid draft.
46. As an agent, I want to retry after a transient failure without it permanently blocking the ticket, so that one bad response is not final.
47. As the team owner, I want customer email addresses and phone numbers removed from the text before it is sent to the AI provider, so that personal data exposure is minimised.
48. As the team owner, I want the customer email wrapped as untrusted data in the prompt, so that instructions hidden in an email are less likely to be followed.
49. As an agent, I want a loading state while triage runs, so that I know something is happening.

### Reply and audit
50. As an agent, I want to review the AI draft in an editable box, so that I can fix tone and facts.
51. As an agent, I want to send the reply with an explicit action, so that nothing goes out by accident.
52. As the team owner, I want nothing ever sent automatically, so that a human always takes responsibility.
53. As an auditor, I want every sent reply to record who sent it and when, so that we can trace any message.
54. As an auditor, I want both the original AI draft and the final sent text stored, so that we can see what the agent changed.
55. As an agent, I want the thread to show whether a reply was edited before sending, so that reviewers see how much the AI was changed.
56. As an agent, I want sending to set the ticket to replied, so that the queue reflects reality.
57. As an agent, I want to be prevented from sending an empty reply, so that blank messages are impossible.
58. As an agent, I want a double click on send to produce only one reply, so that the customer is not messaged twice.
59. As an agent, I want a reply to be sendable even when triage failed or the cap is reached, so that AI problems never block support.

### Help article grounding (stretch)
60. As an agent, I want to see the help article the draft is based on next to the reply, so that I can check the claim against the source.
61. As an agent, I want a draft that is not based on any article to be labelled as ungrounded, so that I review it with extra care.
62. As an admin, I want the help articles stored as seeded data, so that the team can extend them later.

### Operations
63. As a developer, I want one command to run the whole app locally, so that anyone can try it.
64. As a developer, I want an example configuration file with every variable documented, so that setup is not guesswork.
65. As the team owner, I want a public HTTPS URL on AWS that survives a server reboot, so that the team and reviewers can reach it reliably.
66. (Optional, only if everything else works) As a developer, I want every push to be linted, type-checked and tested, so that regressions are caught early.
67. (Optional, only if everything else works) As a developer, I want a push to the main branch to build, publish and deploy automatically, so that the live URL is always current.
68. As a developer, I want a health check to confirm the app and database are up after each deploy, so that a broken deploy is noticed straight away.
69. As a developer, I want database migrations to run before the app starts, so that a failed migration blocks a bad release.
70. As the team owner, I want secrets kept out of the repository and the CI logs, so that the AI key cannot leak.
71. As a reviewer, I want sample emails and seeded demo data, so that the app is demonstrable immediately.
72. As a reviewer, I want a README that states what was built, what was left out, one known problem and how to fix it, so that I can judge the trade-offs.

## Implementation Decisions

**Product shape**
- A single full-stack TypeScript web application with a Postgres database. One schema library defines the validation shapes used by forms, the webhook and the AI output.
- Users are seeded (four agents, one admin) with hashed passwords and signed session cookies. No sign-up. Sign-in attempts are rate-limited in memory per address.
- Roles are enforced on the server. The reassign action returns 403 to agents. Only admins assign or reassign tickets; new tickets start unassigned. Any agent may reply to any ticket.

**Ticket model**
- A ticket has customer email, subject, source (webhook or form), status (open, replied, closed), optional assignee, creation time, and an external message identifier used for idempotency.
- A ticket holds the customer's original message and its sent replies. Every inbound email creates a new ticket; there is no threading of follow-ups.
- The sample email format is defined by this project (no vendor format was supplied): sender, subject, body, received time and message id as JSON. Sample emails are generated by the team and seeded.

**Webhook**
- Requires a shared-secret header, compared in constant time. Enforces a body size limit. Duplicate message ids return success without creating a second ticket. Invalid payloads return a 4xx with a reason. A valid, new message always creates a new ticket.

**Ticket list**
- Keyset (cursor) pagination ordered by creation time then id, 20 per page. The cursor is opaque to clients. The status filter and the cursor are carried in the URL; changing a filter drops the cursor. Navigating back uses browser history.
- The list shows category and urgency only for tickets that already have a stored triage result. This is a deliberate consequence of on-demand triage and is documented as a trade-off.

**Triage**
- Triage is on demand, once per ticket, cached in the database. Admin-only regenerate. A daily call cap from configuration is checked before calling the provider.
- The provider is Google Gemini through its official SDK, using a small low-cost model chosen by configuration, with JSON output requested against a schema and a generous output token limit.
- All provider access sits behind a single triage function. This is the only place tests substitute a fake.
- The result shape is: category (billing, technical, account, feature request, other), urgency (low, medium, high), draft reply (non-empty, bounded length), and article reference (a known article id or null). The result is re-validated with the schema library regardless of what the provider claims, and the article id must exist in the article table. Any failure stores an error record, including the raw output, and the UI shows an error rather than a draft.
- Customer email addresses and phone numbers are redacted from the ticket text before it is sent to the provider. The ticket text is placed in the prompt as delimited, untrusted data. The full set of help articles (about eight to ten, seeded) is included in the prompt; no retrieval layer.
- The cap race (two simultaneous requests overshooting the cap) is the project's documented known problem, with an atomic counter update as the fix.

**Reply**
- A reply record stores the ticket, the AI draft (if any), the final text, the sending user, the send time and whether it was edited. Sending sets the ticket to replied and is idempotent against double submission. Replies are recorded in the application only; no email is delivered to customers in this scope.

**Deployment**
- Local: Docker Compose runs the app, database and a migration step that completes before the app starts. An example environment file documents all configuration.
- Production: one AWS EC2 instance with an Elastic IP, running Docker Compose with a reverse proxy that obtains an HTTPS certificate on a wildcard-DNS hostname derived from the IP. The certificate is verified early because the issuer rate-limits.
- Deploys are manual at first: pull the latest code on the server and rebuild with Compose. This is set up in the very first slice so HTTPS and hosting problems surface early. The production environment file is created by hand on the server.
- CI/CD is an optional last slice, only if everything else works: lint, type-check, tests (against a Postgres service) and an image build on every push; on the main branch, publish a commit-tagged image, deploy over SSH with a dedicated key in a scoped GitHub environment, and smoke-test the health endpoint. If time is short, CI alone (no deploy) is the fallback. No auto-rollback.

**UI**
- Clean and functional, built with a standard component kit: ticket list with filters, ticket detail with message thread, triage panel, reply editor and article side panel.

## Testing Decisions

- A good test exercises external behaviour only: an HTTP request goes in, a response and persisted state come out. Tests do not assert on internal function calls or private structure.
- **Seam 1 (primary):** the HTTP API layer, run against a real Postgres. Covers sign-in and session, role enforcement (agent 403 vs admin 200 on reassign), webhook secret, size limit, idempotency and threading, ticket creation from the form, list filtering and cursor paging (stability when rows are inserted between pages), triage caching, the daily cap, regenerate permissions, reply recording (who, when, draft, edited flag, double-send), and status transitions.
- **Seam 2 (the only stub):** the triage provider function. Tests supply canned results: valid, malformed JSON, wrong enum value, empty draft, unknown article id, and a thrown provider error. Real Gemini is never called in CI, so CI cannot consume the spend cap.
- The UI is not unit-tested. The deployed health smoke test in CI and a rehearsed live demo cover the end-to-end path.
- There is no prior art; this is a new codebase, so the first tests establish the pattern (API-level, real database, one fake).

## Out of Scope

- Actually delivering replies by email (SES or any other provider).
- Automatic or background triage of every incoming ticket.
- Live updates and the overdue marker (the stretch choice is help-article grounding only).
- Threading follow-up emails into existing tickets.
- Claiming tickets and the Mine/Unassigned filter; the list filters by status only.
- Public, customer-facing ticket form; customer accounts.
- High availability, managed database (RDS), container orchestration, auto-rollback.
- Retrieval or embeddings for the help articles; article management UI.
- Attachment handling, rich-text or HTML email rendering, spam filtering.
- SSM/OIDC-based deploys and a secrets manager (named in the README as the production path).

## Further Notes

- **Cost:** with the default model and roughly 4k tokens in and under 1k out, a triage costs about $0.003, so the daily cap plus on-demand triage keeps spend well under the key's limit.
- **Data handling risk:** if the provided Gemini key is on the free tier, the provider may use prompts to improve its products. Redaction reduces but does not remove this; production should use a paid key. Recorded in the README.
- **Prompt injection:** no automated defence is complete. The real control is that a human reviews every draft and nothing is sent automatically.
- **Known problem for the README:** the daily-cap race, fixed with an atomic counter update.
- **Demo plan:** most sample emails are seeded, a few already triaged so the demo does not depend on provider latency; two arrive live through the webhook and one is triaged live. The agent 403 on reassign is shown live.
- **Time plan (8h):** hand-deployed skeleton first, then auth, list and form, webhook, reassign, triage core (hard checkpoint at 4:30), reply and audit, triage hardening (the first thing to trim), article panel, smoke test and rehearsal, and optional CI/CD last. The README is built up slice by slice; each slice adds its own "left out" and "known problem" lines.
