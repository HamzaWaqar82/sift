# 15: Gmail IMAP reader

**What to build:** Customers email the support Gmail address and, within seconds, a ticket appears or their reply joins the existing conversation. Real mail now works end to end.

**Blocked by:** 04, 13, 14

**Status:** done

- [x] The worker holds one IMAP connection (`imapflow`) to `imap.gmail.com` in IDLE mode, with a 60-second poll as fallback, reconnecting automatically
- [x] Tracks the last processed UID so a restart doesn't reprocess or skip mail
- [x] Production ingests only mail not addressed to the `+staging` alias. Staging ingests only mail addressed to it
- [x] The health check reports the IMAP connection
- [ ] Verified manually on staging: email the `+staging` address, the ticket appears live, reply from the app, answer from the mail client, and the answer threads into the same ticket

## Owner steps

1. Staging `.env` (`~/sift-staging/.env`): set `MAIL_TRANSPORT=gmail` (plus the existing `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_ALLOWED_RECIPIENTS`), then `docker compose -f compose.staging.yaml up -d --build`. Production already defaults to gmail; no new variables.
2. Check `https://<staging host>/api/health` shows `"imap":"up"`.
3. Manual check (last box): from an allowlisted address, email `lowtide.zkl+staging@gmail.com`; the ticket appears live. Reply from the app, answer from the mail client, and confirm the answer joins the same ticket. Production must not create a ticket for that mail.

Notes: on its first start each environment begins at the end of the INBOX (older mail is not imported). Given-up mail is logged as `[imap] GAVE UP` and kept in `imap_failures`.
