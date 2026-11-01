# 11: Live updates

**What to build:** New tickets and changes appear without refreshing. If the live connection fails, the app quietly polls instead.

**Blocked by:** 09

**Status:** done (except the smoke check, see below)

- [x] An event bus: `publish` uses Postgres `NOTIFY`, and one `LISTEN` connection fans events out in-process
- [x] Authenticated SSE at `/api/events` with a 20-second heartbeat and `X-Accel-Buffering: no`. Caddy doesn't buffer this route
- [x] Event payloads carry ids and small facts only, never customer text
- [x] Ticket creation and status changes publish events. New tickets are prepended to the list, rows are patched in place, and counts update
- [x] A ticket being viewed shows "<name> just replied". An open reply composer is never modified
- [x] After 3 failed connections, the client polls every 20 seconds and shows a "Live updates paused" chip
- [x] Tests: subscribe in-process, act through a route, assert the event
- [ ] Smoke check added: a ticket posted to the webhook appears in an open list without a reload (not done: ticket 01's `e2e/` Playwright suite was not on staging yet; add it to `e2e/smoke.spec.ts` once 01 lands)

## Notes

- Publish with one line from anywhere (app or worker): `await publish({ type: "ticket.updated", ticketId, status })` from `@/lib/events`; pass `tx` as the second argument inside a transaction so the event goes out on commit. The event union lives only in `lib/events/types.ts`.
- Published today: `ticket.created` (createTicket), `ticket.updated` (close, reopen, reply), `ticket.assigned`/`ticket.released` (assignTicket), `message.created` (sendReply), `triage.updated` (requestTriage), `note.created` (addNote).
- The client refreshes the server-rendered page on each event (debounced), which keeps client state such as the reply composer.
- Caddy: `/api/events` is proxied without `encode gzip` and with `flush_interval -1`. The staging site block (ticket 01) needs the same `handle /api/events` block.
