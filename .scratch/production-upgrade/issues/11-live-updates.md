# 11: Live updates

**What to build:** New tickets and changes appear without refreshing. If the live connection fails, the app quietly polls instead.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] An event bus: `publish` uses Postgres `NOTIFY`, and one `LISTEN` connection fans events out in-process
- [ ] Authenticated SSE at `/api/events` with a 20-second heartbeat and `X-Accel-Buffering: no`. Caddy doesn't buffer this route
- [ ] Event payloads carry ids and small facts only, never customer text
- [ ] Ticket creation and status changes publish events. New tickets are prepended to the list, rows are patched in place, and counts update
- [ ] A ticket being viewed shows "<name> just replied". An open reply composer is never modified
- [ ] After 3 failed connections, the client polls every 20 seconds and shows a "Live updates paused" chip
- [ ] Tests: subscribe in-process, act through a route, assert the event
- [ ] Smoke check added: a ticket posted to the webhook appears in an open list without a reload
