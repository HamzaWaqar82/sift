import { expect, test } from "@playwright/test";

// The smoke suite is capped: at most 4 more checks after these three (see ticket 01).

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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe("/sign-in");
});
