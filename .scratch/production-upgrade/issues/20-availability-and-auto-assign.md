# 20: Availability and auto-assignment

**What to build:** New tickets go straight to the available agent with the fewest open tickets. Agents mark themselves Away to stop receiving new work.

**Blocked by:** 05, 19

**Status:** ready-for-agent

- [ ] Available/Away toggle in the header. The team's presence is visible. Admins can set anyone Away
- [ ] On creation (and when a pooled ticket gets a customer reply), assign in one transaction to the active, available user with the fewest open tickets, ties broken by `last_assigned_at`. If no one is available, the ticket goes to the pool
- [ ] Away users keep the tickets they already own
- [ ] A toast and row highlight when a ticket is assigned to me
- [ ] Tests: least-loaded choice, tie-break, Away excluded, pool fallback
