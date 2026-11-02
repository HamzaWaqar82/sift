# 07: Password reset and email change

**What to build:** A user who forgot their password resets it by email. A user changing their email address keeps the old address until the new one is confirmed.

**Blocked by:** 04, 05

**Status:** done

- [x] Reset request always returns a generic 200. The link expires after 1 hour, works once, and completing it revokes the user's other sessions
- [x] Reset is limited to 3 per hour per email and 10 per hour per IP
- [x] Email change applies only after confirmation from the new address, then revokes sessions
- [x] Reset requested, reset completed and email change are written to the audit log
- [x] Tests cover each rule above
