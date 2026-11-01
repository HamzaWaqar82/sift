# 18: Automatic triage on arrival

**What to build:** New tickets arrive already triaged, unless the budget says wait. Agents' manual clicks always keep a share of the budget.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] Ticket creation (form, webhook, inbound email) enqueues `triage.auto` after saving and responds immediately
- [ ] Automatic jobs use at most `100 − AI_MANUAL_RESERVE_PCT` percent (default 80%) of the daily cap. Manual jobs always run first
- [ ] Customer replies never trigger automatic triage
- [ ] PRODUCT.md and the README record the reversal of "triage on demand only"
- [ ] Tests: reserve respected, manual before automatic, replies don't re-triage
