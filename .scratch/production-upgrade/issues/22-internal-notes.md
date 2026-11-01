# 22: Internal notes

**What to build:** Any agent can leave a staff-only note on any ticket. That keeps ownership collaborative instead of a wall.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] `internal_notes` table. Notes appear inline in the conversation, styled lilac and labelled *Internal note*
- [ ] Never emailed, never included in AI prompts, doesn't change ownership or the overdue clock
- [ ] Publishes `note.created`
- [ ] Tests: any agent can add one, excluded from the prompt and from outbound mail
