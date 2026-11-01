import { expect, test } from "@playwright/test";

// The smoke suite is capped: at most 3 more checks after these four (see ticket 01).

test("health check returns 200", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", db: "up" });
});

test("sign-in page loads", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("a seeded user can sign in", async ({ page }) => {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD must be set");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe("/sign-in");
});

test("a ticket posted to the webhook appears in an open list without a reload", async ({ page, request }) => {
  const secret = process.env.SMOKE_WEBHOOK_SECRET;
  test.skip(!secret, "SMOKE_WEBHOOK_SECRET is not set");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password").fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.goto("/?sv=all");

  const subject = `Smoke live update ${Date.now()}`;
  const res = await request.post("/api/webhook", {
    headers: { "x-webhook-secret": secret! },
    data: {
      from: { email: "smoke@example.com", name: "Smoke Test" },
      subject,
      body: "Posted by the staging smoke suite.",
      message_id: `<smoke-${Date.now()}@sift.test>`,
    },
  });
  expect(res.status()).toBe(201);
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
});

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

test("a sent reply reaches the dev mailbox", async ({ page, request }) => {
  const secret = process.env.SMOKE_WEBHOOK_SECRET;
  test.skip(!secret, "SMOKE_WEBHOOK_SECRET is not set");
  const subject = `Smoke reply ${Date.now()}`;
  const res = await request.post("/api/webhook", {
    headers: { "x-webhook-secret": secret! },
    data: { from: { email: "smoke@example.com", name: "Smoke Test" }, subject, body: "Reply to me.", message_id: `<smoke-reply-${Date.now()}@sift.test>` },
  });
  expect(res.status()).toBe(201);
  const ticketId = (await res.json()).ticket.id;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password").fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole("button", { name: "Claim ticket" }).click();
  await page.getByLabel("Reply to the customer").fill("Sent by the staging smoke suite.");
  await page.getByRole("button", { name: "Send reply" }).click();
  // The worker hands it to the capture transport; the live update then stamps it Sent.
  await expect(page.getByRole("article", { name: /^Reply sent by/ })).toBeVisible({ timeout: 30_000 });
  await page.goto("/dev/mailbox");
  await expect(page.getByText(`Re: ${subject}`).first()).toBeVisible();
});
