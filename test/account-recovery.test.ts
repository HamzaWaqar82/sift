import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/lib/jobs";
import { FakeMailer, setMailer } from "@/lib/mail";
import { postSignIn, seedTestUsers, signInAs, TEST_ORIGIN, TEST_PASSWORDS } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let fake: FakeMailer;
let ipCounter = 0;
const freshIp = () => `10.8.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

beforeEach(async () => {
  // Undo any email change from an earlier test before the seed looks the staff up by email.
  await sql`update users set email = 'alice@sift.local' where name = 'Alice Agent' and email <> 'alice@sift.local'`;
  await seedTestUsers();
  await sql`truncate account_tokens, jobs, audit_log restart identity`;
  await sql`delete from users where email like '%@elsewhere.test'`;
  fake = new FakeMailer();
  setMailer(fake);
});
afterEach(() => setMailer(null));
afterAll(() => sql.end());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: TEST_ORIGIN, "x-forwarded-for": freshIp(), ...headers },
    body: JSON.stringify(body),
  });

async function requestReset(email: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/auth/password-reset/request/route");
  return POST(post("/api/auth/password-reset/request", { email }, headers));
}

async function completeReset(token: string, password = "a-brand-new-password", headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/auth/password-reset/complete/route");
  return POST(post("/api/auth/password-reset/complete", { token, password }, headers));
}

async function changeEmail(cookie: string, newEmail: string, password = TEST_PASSWORDS.alice) {
  const { POST } = await import("@/app/api/me/email/route");
  return POST(post("/api/me/email", { newEmail, password }, { cookie }));
}

async function confirmEmail(token: string) {
  const { POST } = await import("@/app/api/email-change/confirm/route");
  return POST(post("/api/email-change/confirm", { token }));
}

async function me(cookie: string) {
  const { GET } = await import("@/app/api/me/route");
  return GET(new Request("http://localhost/api/me", { headers: { cookie } }));
}

/** Sends the queued mail and returns the token from the link in the newest email. */
async function sentToken(path: "reset-password" | "confirm-email") {
  await runDueJobs();
  const last = fake.sent[fake.sent.length - 1];
  const link = last?.text.match(new RegExp(`https?://\\S+/${path}/([\\w-]+)`));
  if (!link) throw new Error(`no ${path} link in the email`);
  return link[1];
}

// Sign-in failures from the checks below are audited too; these tests are about the other actions.
const auditActions = async () =>
  (await sql`select action from audit_log where action <> 'sign_in_failed' order by id`).map((r) => r.action);

describe("password reset", () => {
  it("emails a link; completing it sets the password, signs out everywhere and is audited", async () => {
    const elsewhere = await signInAs("alice@sift.local");
    const res = await requestReset("Alice@Sift.local");
    expect(res.status).toBe(200);
    const token = await sentToken("reset-password");
    expect(fake.sent[0]).toMatchObject({ to: ["alice@sift.local"] });
    // Only a hash is stored: the token is in neither the token row nor the job.
    expect(JSON.stringify(await sql`select * from account_tokens`)).not.toContain(token);
    expect(JSON.stringify(await sql`select payload from jobs`)).not.toContain(token);

    expect((await completeReset(token)).status).toBe(200);
    expect((await me(elsewhere)).status).toBe(401);
    expect((await postSignIn("alice@sift.local", "a-brand-new-password")).status).toBe(200);
    expect((await postSignIn("alice@sift.local", TEST_PASSWORDS.alice)).status).toBe(401);
    expect(await auditActions()).toEqual(["password_reset_requested", "sessions_revoked", "password_reset_completed"]);
  });

  it("answers an unknown or deactivated address exactly like a known one, and sends nothing", async () => {
    const known = await (await requestReset("alice@sift.local")).json();
    await sql`update users set deactivated_at = now() where email = 'ben@sift.local'`;
    for (const email of ["nobody@sift.local", "ben@sift.local"]) {
      const res = await requestReset(email);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(known);
    }
    await runDueJobs();
    expect(fake.sent.map((m) => m.to)).toEqual([["alice@sift.local"]]);
  });

  it("works once", async () => {
    await requestReset("alice@sift.local");
    const token = await sentToken("reset-password");
    expect((await completeReset(token)).status).toBe(200);
    const again = await completeReset(token, "another-new-password");
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ code: "reset_invalid" });
    expect((await completeReset("not-a-real-token")).status).toBe(410);
  });

  it("expires after 1 hour", async () => {
    await requestReset("alice@sift.local");
    const token = await sentToken("reset-password");
    const [row] = await sql`select expires_at from account_tokens`;
    const minutes = (new Date(row.expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);
    await sql`update account_tokens set expires_at = now() - interval '1 second'`;
    expect((await completeReset(token)).status).toBe(410);
  });

  it("allows 3 requests per hour per email, then 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await requestReset("alice@sift.local")).status).toBe(200);
    const blocked = await requestReset("alice@sift.local");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(3500);
    // The limit is the same for an address with no account.
    for (let i = 0; i < 3; i++) await requestReset("nobody@sift.local");
    expect((await requestReset("nobody@sift.local")).status).toBe(429);
  });

  it("allows 10 requests per hour per IP across addresses, then 429", async () => {
    const ip = { "x-forwarded-for": "10.99.0.1" };
    for (let i = 0; i < 10; i++) expect((await requestReset(`person${i}@sift.local`, ip)).status).toBe(200);
    const blocked = await requestReset("someone.else@sift.local", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await completeReset("whatever", "a-brand-new-password", ip)).status).toBe(429);
  });
});

describe("email change", () => {
  it("keeps the old address until the new one confirms, then applies it, signs out everywhere and is audited", async () => {
    const alice = await signInAs("alice@sift.local");
    const res = await changeEmail(alice, "Alice.New@elsewhere.test");
    expect(res.status).toBe(202);
    const token = await sentToken("confirm-email");
    expect(fake.sent[0]).toMatchObject({ to: ["alice.new@elsewhere.test"] });

    // Not applied yet: the old address still signs in and the session still works.
    expect((await (await me(alice)).json()).user.email).toBe("alice@sift.local");
    expect((await postSignIn("alice.new@elsewhere.test", TEST_PASSWORDS.alice)).status).toBe(401);

    expect((await confirmEmail(token)).status).toBe(200);
    expect((await me(alice)).status).toBe(401);
    expect((await postSignIn("alice.new@elsewhere.test", TEST_PASSWORDS.alice)).status).toBe(200);
    expect((await postSignIn("alice@sift.local", TEST_PASSWORDS.alice)).status).toBe(401);
    expect((await confirmEmail(token)).status).toBe(410);

    const audit = await sql`select action, metadata from audit_log where action <> 'sign_in_failed' order by id`;
    expect(audit.map((a) => a.action)).toEqual(["email_change_requested", "sessions_revoked", "email_changed"]);
    expect(audit[2].metadata).toEqual({ from: "alice@sift.local", to: "alice.new@elsewhere.test" });
  });

  it("needs the current password and a free address", async () => {
    const alice = await signInAs("alice@sift.local");
    expect((await changeEmail(alice, "alice.new@elsewhere.test", "wrong-password")).status).toBe(400);
    expect((await changeEmail(alice, "ben@sift.local")).status).toBe(409);
    expect((await changeEmail("", "alice.new@elsewhere.test")).status).toBe(401);
    await runDueJobs();
    expect(fake.sent).toHaveLength(0);
  });

  it("refuses to confirm if the new address was taken in the meantime, or the link expired", async () => {
    const alice = await signInAs("alice@sift.local");
    await changeEmail(alice, "alice.new@elsewhere.test");
    const token = await sentToken("confirm-email");
    await sql`update users set email = 'alice.new@elsewhere.test' where email = 'ben@sift.local'`;
    try {
      expect((await confirmEmail(token)).status).toBe(410);
    } finally {
      await sql`update users set email = 'ben@sift.local' where email = 'alice.new@elsewhere.test'`;
    }
    await sql`update account_tokens set expires_at = now() - interval '1 second'`;
    expect((await confirmEmail(token)).status).toBe(410);
    expect((await (await me(alice)).json()).user.email).toBe("alice@sift.local");
  });
});
