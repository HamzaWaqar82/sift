# 14: Inbound ingest and threading

**What to build:** One function turns a raw inbound email into the right outcome: a new ticket, a message appended to an existing conversation, a recognised bounce, or nothing (duplicate). The dev webhook goes through it.

**Blocked by:** 09, 12

**Status:** done

- [x] `ingestInboundEmail(rawMime)` parses with `mailparser` and dedupes on `Message-ID`
- [x] Thread match: `In-Reply-To`/`References` first, then normalised subject plus the same sender within 30 days, otherwise a new ticket
- [x] A matched reply reopens a replied or closed ticket, keeps the owner, sets `last_inbound_at`, and marks the current draft superseded ("Out of date — regenerate") without calling the AI
- [x] A mailer-daemon bounce marks the original outbound message `bounced`, suppresses the address, shows a warning on the reply, and never creates a ticket
- [x] Attachments are noted on the message ("attachment not imported")
- [x] The dev JSON webhook routes through the same path and is refused in production
- [x] Tests with committed `.eml` fixtures: new email, reply with headers, reply without headers, duplicate, bounce, attachment
