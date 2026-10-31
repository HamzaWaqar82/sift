import { seedUsers } from "../scripts/seed.mjs";

/** One password per seeded account, as in production (SEED_PASSWORD_<NAME>). */
export const TEST_PASSWORDS = {
  admin: "test-admin-password",
  alice: "test-alice-password",
  ben: "test-ben-password",
  chloe: "test-chloe-password",
  dev: "test-dev-password",
};

/** The test password for a seeded email ("alice@sift.local" -> TEST_PASSWORDS.alice). */
export function passwordFor(email: string): string {
  return TEST_PASSWORDS[email.split("@")[0].toLowerCase() as keyof typeof TEST_PASSWORDS];
}

/** Seeds the five staff accounts with the test passwords above. */
export function seedTestUsers() {
  return seedUsers(process.env.DATABASE_URL!, TEST_PASSWORDS);
}

let ipCounter = 0;

/** Signs in through the real endpoint and returns a Cookie header value. */
export async function signInAs(email: string) {
  const { POST } = await import("@/app/api/auth/sign-in/route");
  ipCounter += 1;
  const res = await POST(
    new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A distinct address per sign-in so the in-memory rate limit never interferes.
        "x-forwarded-for": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      },
      body: JSON.stringify({ email, password: passwordFor(email) }),
    }),
  );
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
