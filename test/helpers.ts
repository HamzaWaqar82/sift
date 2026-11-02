import postgres from "postgres";
import bcrypt from "bcryptjs";
import { SEED_USERS, seedUsers } from "../scripts/seed.mjs";

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

/** Clears the sign-in rate-limit counters, which live in the database and outlast a test run. */
export async function resetRateLimits() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from rate_limits`;
  } finally {
    await sql.end();
  }
}

/**
 * Makes a seeded user the ticket's owner (only the owner or an admin may send, triage or close).
 * Defaults to alice, the agent most tests act as.
 */
export async function giveTicketTo(ticketId: number, email = "alice@sift.local") {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`update tickets set assignee_id = (select id from users where email = ${email}) where id = ${ticketId}`;
  } finally {
    await sql.end();
  }
}

/**
 * Drops a new ticket's queued automatic triage, so a test about something else (sending, manual
 * triage) starts from an untriaged ticket with an empty job queue.
 */
export async function skipAutoTriage(ticketId: number) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from jobs where kind = 'triage.auto' and (payload->>'ticketId')::int = ${ticketId}`;
    await sql`delete from ticket_triage where ticket_id = ${ticketId}`;
  } finally {
    await sql.end();
  }
}

// One hash per test password, computed once (the seed never overwrites an existing password).
const testHashes = new Map<string, string>();
async function testHash(password: string) {
  if (!testHashes.has(password)) testHashes.set(password, await bcrypt.hash(password, 4));
  return testHashes.get(password)!;
}

/**
 * Seeds the five staff accounts and puts them back as seeded: test password, name, role, active,
 * with fresh rate limits. The seed itself leaves existing accounts alone, so tests reset them here.
 * They start Away, so new tickets land in the pool unless a test makes someone available
 * (auto-assignment is covered in auto-assign.test.ts).
 */
export async function seedTestUsers() {
  await seedUsers(process.env.DATABASE_URL!, TEST_PASSWORDS);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    for (const u of SEED_USERS) {
      const [user] = await sql`
        update users set name = ${u.name}, role = ${u.role}, deactivated_at = null, availability = 'away'
        where email = ${u.email} returning id`;
      await sql`
        update account set password = ${await testHash(TEST_PASSWORDS[u.key])}
        where user_id = ${user.id} and provider_id = 'credential'`;
    }
    await sql`update users set availability = 'away' where email like '%@sift.local'`;
  } finally {
    await sql.end();
  }
  await resetRateLimits();
}

/** Origin of the test app (APP_BASE_URL in setup-env); Better Auth's origin check expects it. */
export const TEST_ORIGIN = "http://localhost";

let ipCounter = 0;

/** POSTs to Better Auth's real sign-in endpoint, as the sign-in form does. */
export async function postSignIn(email: string, password: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/auth/sign-in/email/route");
  ipCounter += 1;
  return POST(
    new Request(`${TEST_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        // A distinct address per sign-in so the per-IP rate limit never interferes.
        "x-forwarded-for": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
        ...headers,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
}

/** Turns a response's session Set-Cookie into a Cookie request header, as a browser would ("" if none). */
export function sessionCookieFrom(res: Response): string {
  const setCookie = res.headers.getSetCookie().find((c) => c.includes(".session_token="));
  return setCookie?.split(";")[0] ?? "";
}

/** Signs in through the real endpoint and returns a Cookie header value. */
export async function signInAs(email: string) {
  const res = await postSignIn(email, passwordFor(email));
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return sessionCookieFrom(res);
}

/**
 * Runs queued triage jobs the way the worker would. Jobs retried after a provider error are made
 * due again at once (up to `rounds` passes); jobs waiting on an AI limit keep their retry time.
 */
export async function runTriageJobs(rounds = 5) {
  const { runDueJobs } = await import("@/lib/jobs");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    for (let i = 0; i < rounds; i++) {
      const summary = await runDueJobs();
      if (summary.retried === 0) return;
      await sql`update jobs set run_at = now() where status = 'queued' and kind like 'triage.%' and attempts > 0`;
    }
  } finally {
    await sql.end();
  }
}

/** POSTs a triage request as `cookie` (optionally `{force}`), then runs the triage job. */
export async function triageViaApi(id: number, cookie: string, body?: unknown) {
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  const res = await POST(
    new Request(`http://localhost/api/tickets/${id}/triage`, {
      method: "POST",
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  await runTriageJobs();
  return res;
}

/** The text of a ticket's opening (first inbound) message. */
export async function openingText(ticketId: number): Promise<string | undefined> {
  const { listMessages } = await import("@/lib/messages");
  return (await listMessages(ticketId)).find((m) => m.direction === "inbound")?.bodyText;
}
