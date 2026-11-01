# 08: Admin user management

**What to build:** An admin sees the whole team, can change roles and deactivate people, and can read the audit log.

**Blocked by:** 05

**Status:** done

- [x] User list shows role, availability, and active or deactivated status
- [x] Role change revokes that user's sessions
- [x] Deactivation (never deletion) revokes sessions and sets the user Away. Releasing their tickets comes in 21
- [x] Audit log view for admins only
- [x] Tests: agent rejected on every admin action, and sessions are actually revoked
