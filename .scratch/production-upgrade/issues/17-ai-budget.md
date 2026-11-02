# 17: AI budget and visible triage states

**What to build:** Every Gemini call respects the free-tier limits. Rate limits never fail silently. Everyone can see the AI budget, and every ticket shows its triage state.

**Blocked by:** 04

**Status:** done

- [x] Manual Triage enqueues a high-priority `triage.manual` job. The UI follows the result through events, or a short poll as fallback
- [x] One database-backed limiter enforces `AI_RPM_LIMIT` (default 12) and `AI_DAILY_CAP` (default 450) for `gemini-3.5-flash-lite` (15 requests/min, 500/day)
- [x] A Gemini 429, or a refusal from our own limiter, requeues the job with backoff, honouring `Retry-After`. It is never stored as a failure
- [x] Ticket triage states: Queued, Triaging…, Triaged, Waiting on AI limit (with retry time), Daily AI limit reached, Failed — Retry, Out of date
- [x] Header chip, e.g. `AI 37/450 today · 3 queued`, turning amber at 80% and showing "paused until HH:MM" while limited
- [x] Admin AI panel: recent calls, 429s, queue depth, failed jobs
- [x] Tests: the limiter at both windows, 429 requeue, terminal states

## Owner steps

- The production server's hand-made `.env` was written by the deploy wizard with `AI_DAILY_CAP=50`, which overrides the new compose default. On the server, in `~/sift/.env`, set `AI_DAILY_CAP=450` and add `AI_RPM_LIMIT=12` (or delete the `AI_DAILY_CAP` line to take the defaults), then `docker compose -f compose.prod.yaml up -d`.
- Staging defaults to `AI_DAILY_CAP=30` and `AI_RPM_LIMIT=4`. If staging and production share one Gemini API key (one AI Studio project), their limits add up against the same quota: keep production's `AI_RPM_LIMIT` + staging's at or under 14, and the two daily caps under 500.
