# 06: Invitations

**What to build:** An admin invites a teammate by email with a role. The invitee receives the email, sets a name and password from the link, and is signed in. Accepting the invite counts as email verification.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Invite form shows the address back for confirmation before sending
- [ ] `invitations` table stores only a token hash. Links expire after 7 days and work only once
- [ ] Admin can list, resend and revoke invites
- [ ] Expired, used or revoked links show a clear message without revealing whether the account exists
- [ ] Invite send is limited to 20 per day per admin. Invite accept is limited to 10 per hour per IP
- [ ] Invite created, accepted and revoked are written to the audit log
- [ ] Tests: happy path, expired, revoked, reused, non-admin rejected
- [ ] Smoke check added: invite a user, then accept the invite from `/dev/mailbox`
