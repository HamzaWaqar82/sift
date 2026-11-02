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
- Tickets arrive by a secured webhook (inbound email) or are logged by an agent from a form (phone/chat).
- Agents scan and filter the queue, open a ticket (already triaged in the background, budget permitting) or request triage by hand, read the draft beside its source article, edit, and send. Replies are recorded in-app (no email delivery).
- Admins reassign tickets and may regenerate a triage; agents cannot.
- Agents may not close a ticket without a sent reply.

## Capabilities and Constraints
- Roles: agent, admin. Seeded accounts; no sign-up.
- Statuses: open, replied, closed. Categories: billing, technical, account, feature request, other. Urgency: low, medium, high.
- Ticket views: inbox split-pane (default), table, board by status; search; filters by status, assignee, category, urgency, source; cursor pagination.
- Stack: Next.js App Router, Tailwind, Postgres/Drizzle, Zod; deployed on AWS EC2.
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
