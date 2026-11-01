# 19: Owner-only sending, claim and release

**What to build:** The shared inbox stays shared, but each ticket has one owner who can send. Anyone can claim an unowned ticket, and the owner can release a ticket back to the pool.

**Blocked by:** 09

**Status:** done

- [x] Server enforces the spec's permission matrix for send, request or regenerate triage, close and reopen: `403 not_ticket_owner`, `409 ticket_unassigned`
- [x] Non-owners see "Owned by <name>" instead of Send
- [x] Atomic claim. A loser gets `409 already_claimed` and the UI shows who won
- [x] Owner or admin can release with an optional reason, which is posted as an internal note if notes exist, otherwise stored on the ticket. Release records `released_from_user_id`
- [x] *Mine* is the default view. *Needs an owner* lists unassigned tickets, overdue first
- [x] `assigned_by` recorded. Claim and release are audited and publish events
- [x] Tests: one parametrised test per matrix row in scope, plus two concurrent claims
- [x] Smoke check added: claim a ticket from *Needs an owner*

## Notes

- The smoke suite (`e2e/`, ticket 01) is not on staging yet, and adding a Playwright file now would break `npm run typecheck` (no `@playwright/test`). Add this check to `e2e/smoke.spec.ts` once 01 lands (it posts its own unowned ticket, so it needs `SMOKE_WEBHOOK_SECRET`):

  ```ts
  test("a ticket can be claimed from Needs an owner", async ({ page, request }) => {
    const secret = process.env.SMOKE_WEBHOOK_SECRET;
    test.skip(!secret, "SMOKE_WEBHOOK_SECRET is not set");
    const subject = `Smoke claim ${Date.now()}`;
    const res = await request.post("/api/webhook", {
      headers: { "x-webhook-secret": secret! },
      data: { from: { email: "smoke@example.com", name: "Smoke Test" }, subject, body: "Claim me.", message_id: `<smoke-claim-${Date.now()}@sift.test>` },
    });
    expect(res.status()).toBe(201);
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(process.env.SMOKE_EMAIL!);
    await page.getByLabel("Password").fill(process.env.SMOKE_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.goto("/?assignee=unassigned&status=open%2Creplied&sort=overdue&sv=needs-owner");
    await page.getByText(subject).first().click();
    await page.getByRole("button", { name: "Claim ticket" }).click();
    await expect(page.getByRole("button", { name: "Send reply" })).toBeVisible();
  });
  ```
- 01's existing live-update smoke check opens `/` and waits for a new unowned webhook ticket. `/` now redirects to *Mine*, so that check must open `/?sv=all` instead.
