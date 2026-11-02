# 16: Remove `tickets.body` and `replies` (contract)

**What to build:** The old single-body ticket shape and the `replies` table are removed now that everything reads and writes `messages`.

**Blocked by:** 14

**Status:** done

- [x] Nothing reads `tickets.body` or `replies`. Dual writes are removed
- [ ] Migration drops the column and the table, after being rehearsed on staging against a copy of the production data (migration `0015_messages_contract` written and tested; the rehearsal needs the owner, see below)
- [x] All tests green

Notes: `0015_messages_contract` first copies anything `messages` lacks (a ticket with no inbound message, a reply whose idempotency key has no message) and only then drops. The replies API (`GET/POST /api/tickets/:id/replies`) keeps its response shape, now read from outbound messages (`reply.id` is the message id). Ticket JSON no longer has `body`; the opening text is the first inbound message.

## Owner steps

Rehearse on staging with a copy of production data BEFORE merging this branch into `staging` (staging migrates on deploy). On the server:

1. `cd ~/sift && docker compose -f compose.prod.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > /tmp/prod.dump`
2. `cd ~/sift-staging && docker compose -f compose.staging.yaml stop app worker`
3. `docker compose -f compose.staging.yaml exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < /tmp/prod.dump && rm /tmp/prod.dump`
4. Merge the PR into `staging`. The staging deploy runs the `migrate` service (0015) and the smoke tests.
5. Check: `docker compose -f compose.staging.yaml logs migrate` shows success, and tickets still show their opening message and replies. Then tick the box above.
