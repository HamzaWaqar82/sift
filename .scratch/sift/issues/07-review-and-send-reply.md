# 07: Review, edit and send reply with audit

**What to build:** An agent reviews a draft (or writes one), edits it, and sends it with an explicit action. Nothing is sent automatically. Each sent reply is recorded with who sent it and when, and the thread shows it. Sending works whether or not triage exists, so this slice does not depend on triage.

**Time box:** 4:30–5:15 (45 min)

**Blocked by:** 03

**Status:** done

- [x] The reply box starts with the AI draft when one exists, otherwise empty; it is editable
- [x] Sending requires an explicit action and rejects an empty reply
- [x] A sent reply stores: ticket, AI draft (if any), final text, sending user, send time, and an edited flag
- [x] Sending sets the ticket to replied; the thread shows the reply with sender, time and "edited" or "unedited"
- [x] Double click or double submit produces only one reply
- [x] Sending works for a ticket with no triage, a failed triage, or when the daily cap is reached
- [x] Any agent can reply to any ticket
- [x] API-level tests cover: send records sender and time, edited flag, status change, empty rejected, double submit, unauthenticated
- [x] README: state clearly that replies are recorded in the app only and no email is delivered (SES left out)
