import { defineConfig, devices } from "@playwright/test";

// Smoke suite: runs only against a deployed URL (the staging deploy workflow sets SMOKE_BASE_URL).
// Locally: SMOKE_BASE_URL=http://localhost:3000 SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) throw new Error("SMOKE_BASE_URL is not set");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
