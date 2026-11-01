# 13: Gmail outbound

**What to build:** Replies actually reach customers' inboxes through the dedicated Gmail account, threaded in their mail client. One Gmail account serves both environments.

**Blocked by:** 01, 12

**Status:** done (pending owner steps)

- [x] `gmail` adapter: SMTP over SSL to `smtp.gmail.com` with an app password, using `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `MAIL_FROM_NAME`
- [x] Spike: does Gmail keep our `Message-ID`? If not, read the real id back from the Sent folder and store it
- [x] Production refuses to start unless `MAIL_TRANSPORT=gmail` with credentials set
- [x] Staging sends real mail only to `MAIL_ALLOWED_RECIPIENTS`, captures everything else, and sets the reply address to the `+staging` alias
- [x] The health check reports whether SMTP is reachable
- [x] Owner provides the Gmail address and app password when this ticket starts (ask then). Give step-by-step setup if 2-Step Verification or the app password isn't ready
- [ ] Verified manually on staging: a reply arrives at an allowlisted inbox and threads correctly

## Spike result (2026-11-02)
Gmail SMTP keeps our generated `Message-ID` (and `In-Reply-To`/`References`) unchanged; checked by sending to the account itself and reading the copy in `[Gmail]/Sent Mail` over IMAP. No Sent-folder read-back is needed. IMAP login with the app password also works (ticket 15).

## Notes for later tickets
- A 5xx refusal of the recipient/message throws `PermanentMailError`: the reply fails at once, no retries. Login failures, the 550 5.4.5 daily limit and network errors stay retryable.
- Our sent mail also appears in `[Gmail]/Sent Mail` and "All Mail": ticket 15's reader must ignore messages from `GMAIL_USER` and ingest from INBOX only.
- `/api/health` reports `mail` (up/down/capture/fake/misconfigured), probing Gmail at most every 5 min.

## Owner steps
1. **Staging** (`~/sift-staging/.env`): add `GMAIL_USER=<support address>`, `GMAIL_APP_PASSWORD=<app password>`, `MAIL_TRANSPORT=gmail`, `MAIL_ALLOWED_RECIPIENTS=<your own test inbox>`. Redeploy staging.
2. **Verify on staging:** reply to a ticket whose customer is the allowlisted inbox; it arrives from "Sift Support (staging)", threads under the original, and Reply-To is the `+staging` alias. `/api/health` shows `"mail":"up"`.
3. **Production** (`~/sift/.env`), BEFORE promoting this to main: add `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Without them production refuses to start (by design).
