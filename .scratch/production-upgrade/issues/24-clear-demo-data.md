# 24: Clear demo data before production sends real mail

**What to build:** Production's demo tickets (seeded from `samples/emails.json` on every deploy) carry realistic customer addresses at gmail.com, outlook.com and real-looking company domains. Once production sends real mail (13), replying to one could email a stranger. Stop seeding them in production, remove the ones already there, and make sure no mail can ever reach a sample address in production.

**Blocked by:** 13

**Status:** done (pending owner steps)

- [x] The seed never inserts sample tickets when `APP_ENV=production` (users are still seeded and updated). Dev, test and staging keep the sample tickets
- [x] One-off, idempotent `scripts/clear-demo-data.mjs`: deletes only tickets whose `external_message_id` is a `samples/emails.json` message_id, with their messages, notes, triage and replies (cascade) and queued jobs about them; prints how many it removed. It ships in the `migrator` image (`scripts/` and `samples/` are copied there)
- [x] Production refuses outbound mail to any `samples/emails.json` address (`DemoRecipientGuard` wraps every mailer in `getMailer()`): the reply fails at once with a clear reason, nothing is sent
- [ ] Owner runs the cleanup on the production server (below)

## Owner steps

After this change is deployed to production, and before replying to anything there, run on the server from the deploy directory (default `~/sift`):

```sh
docker compose -f compose.prod.yaml run --rm migrate node scripts/clear-demo-data.mjs
```

It prints `removed N demo tickets` (up to 14 the first time; 0 on any rerun). Then tick the last box.
