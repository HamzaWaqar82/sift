# 09: Add `messages` (expand)

**What to build:** A ticket becomes a conversation. A new `messages` table holds every inbound and outbound message. Existing data is back-filled, and the ticket detail shows the thread. The old `tickets.body` and `replies` keep working alongside it; this is the expand step of an expand–contract refactor.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `messages` table as in the spec's data model. Back-fill: the ticket body becomes the first inbound message, and replies become sent outbound messages
- [ ] `tickets` gains `last_inbound_at` and `last_outbound_at`, back-filled
- [ ] Ticket creation (form and webhook) and sending a reply write to both the old fields and `messages`
- [ ] Ticket detail renders the conversation from `messages`. Triage reads the latest inbound message
- [ ] Search matches any message in a ticket
- [ ] Migration test seeds old-shape data and asserts the result
