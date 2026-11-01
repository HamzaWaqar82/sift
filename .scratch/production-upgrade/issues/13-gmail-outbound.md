# 13: Gmail outbound

**What to build:** Replies actually reach customers' inboxes through the dedicated Gmail account, threaded in their mail client. One Gmail account serves both environments.

**Blocked by:** 01, 12

**Status:** ready-for-agent

- [ ] `gmail` adapter: SMTP over SSL to `smtp.gmail.com` with an app password, using `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `MAIL_FROM_NAME`
- [ ] Spike: does Gmail keep our `Message-ID`? If not, read the real id back from the Sent folder and store it
- [ ] Production refuses to start unless `MAIL_TRANSPORT=gmail` with credentials set
- [ ] Staging sends real mail only to `MAIL_ALLOWED_RECIPIENTS`, captures everything else, and sets the reply address to the `+staging` alias
- [ ] The health check reports whether SMTP is reachable
- [ ] Owner provides the Gmail address and app password when this ticket starts (ask then). Give step-by-step setup if 2-Step Verification or the app password isn't ready
- [ ] Verified manually on staging: a reply arrives at an allowlisted inbox and threads correctly
