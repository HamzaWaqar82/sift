# 06: AI triage core (call, shape check, article check, error UI, cached)

**What to build:** When an agent opens a ticket they can request triage. One Gemini call returns a category, an urgency, a draft reply and a help-article reference as JSON. The result is validated before it is shown; if it does not match, the agent sees an error instead. The result is cached so each ticket costs at most one call. This is the hard checkpoint of the project.

**Time box:** 3:40–4:30 (50 min). **Checkpoint at 4:30:** if this is not working end to end, cut slice 08 first and reduce the stretch.

**Blocked by:** 03

**Status:** done

- [x] Roughly eight to ten short help articles are written and seeded
- [x] All Gemini access sits behind one triage function; the model is chosen by configuration; JSON output is requested against a schema with a generous output token limit
- [x] The result is re-validated: category and urgency from fixed lists, non-empty bounded draft, article id either null or an existing article
- [x] Any validation or provider failure stores an error (with the raw output) and the UI shows an error state with the raw output collapsed; an invalid result is never displayed as a draft
- [x] A valid result is stored on the ticket and shown on every later visit without another provider call
- [x] A failed result can be retried by the agent without blocking the ticket forever
- [x] Loading state while the call runs
- [x] Ticket text is wrapped as delimited untrusted data in the prompt
- [x] API-level tests use a fake triage function and cover: valid, malformed JSON, wrong enum, empty draft, unknown article id, provider error, cache hit makes no second call
- [x] One real call against the provided key is made manually to confirm it works end to end
- [x] README: record the cost-per-ticket arithmetic and the prompt-injection note (human review is the real control)
