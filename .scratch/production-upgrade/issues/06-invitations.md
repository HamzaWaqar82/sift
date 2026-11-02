# 06: Invitations

**What to build:** An admin invites a teammate by email with a role. The invitee receives the email, sets a name and password from the link, and is signed in. Accepting the invite counts as email verification.

**Blocked by:** 04, 05

**Status:** done

- [x] Invite form shows the address back for confirmation before sending
- [x] `invitations` table stores only a token hash. Links expire after 7 days and work only once
- [x] Admin can list, resend and revoke invites
- [x] Expired, used or revoked links show a clear message without revealing whether the account exists
- [x] Invite send is limited to 20 per day per admin. Invite accept is limited to 10 per hour per IP
- [x] Invite created, accepted and revoked are written to the audit log
- [x] Tests: happy path, expired, revoked, reused, non-admin rejected
- [x] Smoke check added: invite a user, then accept the invite from `/dev/mailbox`

## Notes for later tickets

- Accepting is `acceptInvite()` in `lib/invitations`: one guarded `update` claims the invite, then it inserts the verified user and credential `account` row (`hashPassword` from `lib/auth/better-auth.ts`) and signs in through Better Auth for the cookie.
- The token is `HMAC(SESSION_SECRET, id:nonce)`; only its SHA-256 is stored and the `mail.invite` payload is `{invitationId, nonce}`. Rotating `SESSION_SECRET` voids pending invites.
- The smoke check needs `SMOKE_EMAIL` to be an admin on staging, and `APP_BASE_URL` set there.
