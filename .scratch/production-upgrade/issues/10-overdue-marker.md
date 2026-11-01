# 10: Overdue marker

**What to build:** Agents see at a glance which customers have been waiting too long. A ticket is overdue when it isn't closed, its latest customer message has no later sent reply, and that message is at least `OVERDUE_HOURS` old (default 24).

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] An *Overdue 1d 4h* badge before the subject in the inbox, table and board views
- [ ] `overdue=1` filter with a removable chip, combinable with every other filter
- [ ] Overdue count in the header, in an orange tone (not urgency red)
- [ ] Closed tickets are never overdue. A new customer message restarts the clock
- [ ] Seed data spreads ticket ages so overdue tickets can be seen right away
- [ ] Tests: the rule's boundaries, the filter, the count, closed tickets excluded, re-arming
