# 15: Gmail IMAP reader

**What to build:** Customers email the support Gmail address and, within seconds, a ticket appears or their reply joins the existing conversation. Real mail now works end to end.

**Blocked by:** 04, 13, 14

**Status:** ready-for-agent

- [ ] The worker holds one IMAP connection (`imapflow`) to `imap.gmail.com` in IDLE mode, with a 60-second poll as fallback, reconnecting automatically
- [ ] Tracks the last processed UID so a restart doesn't reprocess or skip mail
- [ ] Production ingests only mail not addressed to the `+staging` alias. Staging ingests only mail addressed to it
- [ ] The health check reports the IMAP connection
- [ ] Verified manually on staging: email the `+staging` address, the ticket appears live, reply from the app, answer from the mail client, and the answer threads into the same ticket
