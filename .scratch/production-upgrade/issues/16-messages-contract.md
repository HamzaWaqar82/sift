# 16: Remove `tickets.body` and `replies` (contract)

**What to build:** The old single-body ticket shape and the `replies` table are removed now that everything reads and writes `messages`.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Nothing reads `tickets.body` or `replies`. Dual writes are removed
- [ ] Migration drops the column and the table, after being rehearsed on staging against a copy of the production data
- [ ] All tests green
