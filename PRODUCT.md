# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A support team of four agents plus one admin sharing a single customer inbox. Hybrid use: most of the team keeps Sift open in a desktop browser tab through the whole shift and works the queue for hours; it must also orient someone who drops in a few times a day to clear what's new or urgent. Mobile must work, but desktop is the primary scene.

## Product Purpose
Bring the team's tickets into one place and help them reply faster and more safely. Success: every ticket gets a reviewed, correct reply; nothing is sent without a human; the team always knows what needs attention next.

## Positioning
One AI call per ticket returns a category, urgency and a draft reply grounded in a named help article; the result is validated against a strict shape before anyone sees it, and an agent always reviews, edits and sends. The draft, the article it came from, and who sent what are all visible side by side.

## Operating Context
- Customer email arrives from the team's Gmail inbox (read over IMAP); customer replies thread onto their ticket. Agents log phone and chat tickets from a form.
- Every ticket has one owner. New tickets go to the available agent with the fewest open tickets, or wait in *Needs an owner* to be claimed. Agents set themselves Available or Away, release tickets back to the pool, and an unopened assignment moves on after 4 hours. Overdue tickets (no reply for 24 hours) are flagged and returned to the pool.
- The owner opens a ticket (already triaged in the background, budget permitting) or requests triage by hand, reads the draft beside its source article, edits, and sends a real email through Gmail. Staff can leave internal notes that are never emailed.
- The queue updates live; a toast says when someone or something else assigns you a ticket.
- Admins invite and deactivate staff, change roles, reassign tickets and may regenerate a triage; agents cannot.
- Only the owner or an admin may close a ticket, and an agent only after a sent reply.

## Capabilities and Constraints
- Roles: agent, admin. Accounts by admin invitation; no public sign-up. Password reset and email change by emailed link.
- Statuses: open, replied, closed. Categories: billing, technical, account, feature request, other. Urgency: low, medium, high.
- Ticket views: inbox split-pane (default), table, board by status; search; filters by status, assignee, category, urgency, source; cursor pagination.
- Stack: Next.js App Router, Tailwind, Postgres/Drizzle, Zod, Better Auth, a background worker for mail, IMAP and AI jobs; deployed on AWS EC2. Every change goes to staging first (with smoke tests); production changes only through an owner-approved `staging → main` promotion.
- AI spend is capped. New tickets are triaged automatically on arrival (this reverses the original "triage on demand only" rule); automatic triage may use only `100 - AI_MANUAL_RESERVE_PCT` percent of the daily cap, manual clicks run first, and customer replies never trigger a new AI call. Results are cached per ticket.

## Brand Commitments
- Name: **Sift** (kept). No existing logo, colours or fonts; the visual identity is open.

## Evidence on Hand
- Seeded sample emails (`samples/emails.json`) and 10 help articles (`samples/help-articles.json`). These are synthetic demo content.
- No customers, testimonials or metrics exist; do not invent any.

## Product Principles
1. A human sends every reply; the interface makes review the natural path, never a speed bump to click through.
2. Show the source: a draft is always shown next to what it is based on, or clearly marked ungrounded.
3. The queue tells you what's next: urgency, age and ownership are scannable without opening anything.
4. Dense but calm: many tickets visible at once, low visual noise, built for hours of use.
5. Every action is attributable: who sent, who reassigned, when.

## Accessibility & Inclusion
Keyboard-operable throughout (long sessions, power users); WCAG 2.2 AA contrast; respects reduced motion. Must not be dark-only.
