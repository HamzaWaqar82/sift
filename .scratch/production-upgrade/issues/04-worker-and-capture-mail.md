# 04: Background worker and capture mail

**What to build:** A background worker service that processes queued jobs, and a mail abstraction whose dev and test adapters let anyone see emails without a mail account. An admin can send a test email and see it, fully rendered, in the dev mailbox.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `jobs` table. The worker runs as its own Compose service from the same image, claims jobs with `SKIP LOCKED`, ordered by priority then run-at, and recovers stale locks
- [x] One entry point, `runDueJobs()`, processes everything currently due exactly once. The worker loop and tests both call it
- [x] Exhausted jobs end as `failed` with the last error
- [x] `Mailer` interface with `fake` (in-memory, for tests) and `capture` (writes to `dev_mailbox`, viewable at `/dev/mailbox`) adapters, selected by `MAIL_TRANSPORT`
- [x] `/dev/mailbox` is unavailable in production
- [x] The health check reports whether the worker is alive
- [x] Tests: job ordering, retry, failure, stale-lock recovery, capture renders headers and body

## Notes for later tickets

- Job kinds register by importing a module from `lib/jobs/kinds/index.ts` that calls `registerJobHandler(kind, { run, backoffSeconds?, onFailed? })`. `enqueueJob(kind, payload, { priority, runAt, maxAttempts }, tx?)` accepts a transaction. Higher `priority` runs first.
- Mail goes through `getMailer()`; tests install a `FakeMailer` with `setMailer()` (`MAIL_TRANSPORT=fake` is the test default).
- Long-lived worker services (the IMAP reader) go in `WORKER_SERVICES` in `lib/worker/services.ts`.
- `APP_ENV` (development, staging, production) gates `/dev/mailbox`; `compose.prod.yaml` defaults it to production, so the staging stack must set `APP_ENV=staging`.
