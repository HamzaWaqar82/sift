# 04: Background worker and capture mail

**What to build:** A background worker service that processes queued jobs, and a mail abstraction whose dev and test adapters let anyone see emails without a mail account. An admin can send a test email and see it, fully rendered, in the dev mailbox.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `jobs` table. The worker runs as its own Compose service from the same image, claims jobs with `SKIP LOCKED`, ordered by priority then run-at, and recovers stale locks
- [ ] One entry point, `runDueJobs()`, processes everything currently due exactly once. The worker loop and tests both call it
- [ ] Exhausted jobs end as `failed` with the last error
- [ ] `Mailer` interface with `fake` (in-memory, for tests) and `capture` (writes to `dev_mailbox`, viewable at `/dev/mailbox`) adapters, selected by `MAIL_TRANSPORT`
- [ ] `/dev/mailbox` is unavailable in production
- [ ] The health check reports whether the worker is alive
- [ ] Tests: job ordering, retry, failure, stale-lock recovery, capture renders headers and body
