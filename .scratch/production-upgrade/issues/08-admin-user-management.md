# 08: Admin user management

**What to build:** An admin sees the whole team, can change roles and deactivate people, and can read the audit log.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] User list shows role, availability, and active or deactivated status
- [ ] Role change revokes that user's sessions
- [ ] Deactivation (never deletion) revokes sessions and sets the user Away. Releasing their tickets comes in 21
- [ ] Audit log view for admins only
- [ ] Tests: agent rejected on every admin action, and sessions are actually revoked
