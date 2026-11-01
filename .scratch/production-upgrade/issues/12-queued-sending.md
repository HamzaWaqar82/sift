# 12: Queued sending with honest states

**What to build:** Sending a reply queues a real email through the `Mailer`. The reply shows *Sending…*, *Sent ✓* or *Failed — Retry*. Failures retry automatically, and a reply is never shown as sent unless it was.

**Blocked by:** 04, 09

**Status:** done

- [x] Send inserts a `queued` outbound message with an idempotency key and enqueues `mail.send`. Backoff is 10s, 1m, 5m, 30m, 2h, max 5 attempts, then `failed`
- [x] The ticket becomes `replied` and `last_outbound_at` is set only when the message reaches `sent`. Queued and failed replies don't clear overdue
- [x] Manual retry of a failed reply
- [x] Send refuses with `409 stale_ticket` if a message arrived after the composer loaded. Double sends produce one message
- [x] `suppressed_emails` table. Sending to a suppressed address is rejected with a clear message
- [x] Headers: "Sift Support" display name, generated `Message-ID`, `In-Reply-To`/`References` pointing to the latest inbound message
- [x] Message status changes publish events
- [x] Tests use the `fake` mailer: headers, retry and backoff, failure state, suppression, stale 409, idempotency
- [x] Smoke check added: send a reply and see it in `/dev/mailbox`
