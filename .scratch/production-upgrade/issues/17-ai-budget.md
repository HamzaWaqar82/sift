# 17: AI budget and visible triage states

**What to build:** Every Gemini call respects the free-tier limits. Rate limits never fail silently. Everyone can see the AI budget, and every ticket shows its triage state.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Manual Triage enqueues a high-priority `triage.manual` job. The UI follows the result through events, or a short poll as fallback
- [ ] One database-backed limiter enforces `AI_RPM_LIMIT` (default 12) and `AI_DAILY_CAP` (default 450) for `gemini-3.5-flash-lite` (15 requests/min, 500/day)
- [ ] A Gemini 429, or a refusal from our own limiter, requeues the job with backoff, honouring `Retry-After`. It is never stored as a failure
- [ ] Ticket triage states: Queued, Triaging…, Triaged, Waiting on AI limit (with retry time), Daily AI limit reached, Failed — Retry, Out of date
- [ ] Header chip, e.g. `AI 37/450 today · 3 queued`, turning amber at 80% and showing "paused until HH:MM" while limited
- [ ] Admin AI panel: recent calls, 429s, queue depth, failed jobs
- [ ] Tests: the limiter at both windows, 429 requeue, terminal states
