# 04: Webhook intake

**What to build:** Inbound emails posted to a secured webhook become new tickets. Sending the same email twice never creates a duplicate.

**Time box:** 2:50–3:20 (30 min)

**Blocked by:** 03

**Status:** done

- [x] A request without the correct shared-secret header is rejected; the comparison is constant time
- [x] Oversized bodies are rejected
- [x] Malformed or incomplete payloads get a 4xx with a reason
- [x] A valid payload always creates a new ticket with source `webhook`
- [x] Re-posting the same message id returns success and does not create a second ticket
- [x] Two of the seeded sample emails can be posted live with a single `curl` command, documented in the README
- [x] API-level tests cover: missing and wrong secret, size limit, bad payload, success, idempotency
- [x] README: webhook contract documented; "left out" notes no threading and no vendor-specific inbound-email formats
