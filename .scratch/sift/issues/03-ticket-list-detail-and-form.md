# 03: Ticket list, detail view and create form

**What to build:** Agents see all tickets in one place, filter them by status, page through them, open one to read the full message, and create a ticket from a form. Sample emails are generated and seeded so the list looks real.

**Time box:** 2:00–2:50 (50 min)

**Blocked by:** 02

**Status:** done

- [x] List shows tickets newest first with subject, customer, status, assignee, source and age
- [x] Status filter (open, replied, closed); the filter and page position live in the URL; changing the filter restarts from the first page
- [x] Cursor paging, 20 per page, with a Next control; going back uses browser history; inserting tickets between pages never duplicates or skips a ticket
- [x] Empty state shown when nothing matches
- [x] Ticket detail shows the full customer message, status and assignee
- [x] Any agent can close a ticket
- [x] Form creates a ticket (customer email, subject, body) with source `form`; invalid input shows field errors
- [x] A set of realistic sample emails is generated and seeded; the list shows a clear "not triaged yet" marker for each
- [x] API-level tests cover: filtering, cursor paging stability, form validation, close
- [x] README: record the trade-off that category and urgency are not shown in the list until a ticket has been triaged
