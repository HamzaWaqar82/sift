import { seedUsers } from "../scripts/seed.mjs";

export const ADMIN_PASSWORD = "test-admin-password";
export const AGENT_PASSWORD = "test-agent-password";

/** Seeds the five staff accounts with the test passwords above. */
export function seedTestUsers() {
  return seedUsers(process.env.DATABASE_URL!, {
    adminPassword: ADMIN_PASSWORD,
    agentPassword: AGENT_PASSWORD,
  });
}

let ipCounter = 0;

/** Signs in through the real endpoint and returns a Cookie header value. */
export async function signInAs(email: string) {
  const password = email.startsWith("admin@") ? ADMIN_PASSWORD : AGENT_PASSWORD;
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
      body: JSON.stringify({ email, password }),
    }),
  );
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
