# 21: Ack timeout, overdue release and deactivation release

**What to build:** No customer gets stuck behind one person. An unopened assignment moves on, an overdue ticket returns to the pool, and a deactivated agent's tickets are released.

**Blocked by:** 08, 10, 20

**Status:** ready-for-agent

- [ ] `first_opened_at` is set the first time the owner opens a ticket. An auto-assigned ticket still unopened after `ACK_TIMEOUT_MINUTES` (default 240) moves to the next candidate, or to the pool
- [ ] Overdue sweep every 5 minutes: sets `overdue_since` and releases the ticket to the pool with `assigned_by = system`, an audit row and an event
- [ ] Ticket detail shows a banner: "Released from <name> (overdue)"
- [ ] Deactivating a user releases their open tickets
- [ ] Tests through `runDueJobs()` with aged timestamps
