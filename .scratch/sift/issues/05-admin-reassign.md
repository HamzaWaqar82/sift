# 05: Admin reassign

**What to build:** Admins can assign and reassign any ticket to any user. Agents cannot, and the server refuses them even if they call the API directly.

**Time box:** 3:20–3:40 (20 min)

**Blocked by:** 03

**Status:** done

- [x] Admin sees a reassign control on the ticket and can pick any user; the assignee updates in detail and list
- [x] Agent does not see the control
- [x] An agent calling the reassign API directly gets 403 and nothing changes; an admin gets 200
- [x] New tickets start unassigned
- [x] Any agent can still reply to any ticket, regardless of assignee
- [x] API-level tests cover: agent 403, admin 200, unknown user, unauthenticated
- [x] The 403 can be demonstrated live (documented command in the README demo section)
