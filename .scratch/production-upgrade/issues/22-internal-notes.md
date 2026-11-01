# 22: Internal notes

**What to build:** Any agent can leave a staff-only note on any ticket. That keeps ownership collaborative instead of a wall.

**Blocked by:** 09

**Status:** done

- [x] `internal_notes` table. Notes appear inline in the conversation, styled lilac and labelled *Internal note*
- [x] Never emailed, never included in AI prompts, doesn't change ownership or the overdue clock
- [x] Publishes `note.created` (emitted from `addNote`; added with ticket 11)
- [x] Tests: any agent can add one, excluded from the prompt and from outbound mail (no Mailer exists yet; the test asserts notes never enter `messages`, the source outbound mail is built from. Add a fake-`Mailer` assertion when ticket 12 lands.)
