# 19: Owner-only sending, claim and release

**What to build:** The shared inbox stays shared, but each ticket has one owner who can send. Anyone can claim an unowned ticket, and the owner can release a ticket back to the pool.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Server enforces the spec's permission matrix for send, request or regenerate triage, close and reopen: `403 not_ticket_owner`, `409 ticket_unassigned`
- [ ] Non-owners see "Owned by <name>" instead of Send
- [ ] Atomic claim. A loser gets `409 already_claimed` and the UI shows who won
- [ ] Owner or admin can release with an optional reason, which is posted as an internal note if notes exist, otherwise stored on the ticket. Release records `released_from_user_id`
- [ ] *Mine* is the default view. *Needs an owner* lists unassigned tickets, overdue first
- [ ] `assigned_by` recorded. Claim and release are audited and publish events
- [ ] Tests: one parametrised test per matrix row in scope, plus two concurrent claims
- [ ] Smoke check added: claim a ticket from *Needs an owner*
