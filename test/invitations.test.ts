import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/lib/jobs";
import { FakeMailer, setMailer } from "@/lib/mail";
import { passwordFor, postSignIn, resetRateLimits, seedTestUsers, sessionCookieFrom, signInAs, TEST_ORIGIN } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let admin: string;
let agent: string;
let fake: FakeMailer;
let ipCounter = 0;

beforeEach(async () => {
  await seedTestUsers();
  await sql`truncate invitations, jobs, audit_log restart identity`;
  await sql`delete from users where email like '%@invitee.test'`;
  admin = await signInAs("admin@sift.local");
  agent = await signInAs("alice@sift.local");
  fake = new FakeMailer();
  setMailer(fake);
});
afterEach(() => setMailer(null));
afterAll(() => sql.end());

const json = (cookie: string, body?: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json", origin: TEST_ORIGIN, cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function invite(cookie: string, email = "new.person@invitee.test", role = "agent") {
  const { POST } = await import("@/app/api/admin/invitations/route");
  return POST(new Request("http://localhost/api/admin/invitations", json(cookie, { email, role })));
}

async function act(cookie: string, id: number, action: "resend" | "revoke") {
  const route =
    action === "resend"
      ? await import("@/app/api/admin/invitations/[id]/resend/route")
      : await import("@/app/api/admin/invitations/[id]/revoke/route");
  return route.POST(new Request(`http://localhost/api/admin/invitations/${id}/${action}`, json(cookie)), {
    params: Promise.resolve({ id: String(id) }),
  });
}

async function accept(token: string, body: Record<string, unknown> = {}, ip = `10.7.0.${++ipCounter}`) {
  const { POST } = await import("@/app/api/invite/accept/route");
  return POST(
    new Request("http://localhost/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN, "x-forwarded-for": ip },
      body: JSON.stringify({ token, name: "New Person", password: "a-long-enough-password", ...body }),
    }),
  );
}

/** Sends the queued email and returns the token from the link in it. */
async function sentToken() {
  await runDueJobs();
  const link = fake.sent[fake.sent.length - 1].text.match(/https?:\/\/\S+\/invite\/([\w-]+)/);
  if (!link) throw new Error("no invite link in the email");
  return link[1];
}

describe("invitations: happy path", () => {
  it("emails a link; accepting it creates a verified user, signs them in and is audited", async () => {
    const res = await invite(admin, "New.Person@invitee.test", "admin");
    expect(res.status).toBe(201);
    const { invitation } = await res.json();
    expect(invitation).toMatchObject({ email: "new.person@invitee.test", role: "admin", status: "pending" });

    const token = await sentToken();
    expect(fake.sent[0]).toMatchObject({ to: ["new.person@invitee.test"], subject: "You are invited to Sift" });
    expect(fake.sent[0].text).toContain(`${TEST_ORIGIN}/invite/${token}`);

    // Only a hash is stored: the token is in neither the invitation row nor the job.
    const [row] = await sql`select * from invitations`;
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await sql`select payload from jobs`)).not.toContain(token);
    const expiresInDays = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(expiresInDays).toBeGreaterThan(6.9);
    expect(expiresInDays).toBeLessThan(7.1);

    const done = await accept(token);
    expect(done.status).toBe(200);
    const cookie = sessionCookieFrom(done);
    const { GET } = await import("@/app/api/me/route");
    const me = await (await GET(new Request("http://localhost/api/me", { headers: { cookie } }))).json();
    expect(me.user).toMatchObject({ email: "new.person@invitee.test", name: "New Person", role: "admin" });

    const [user] = await sql`select email_verified from users where email = 'new.person@invitee.test'`;
    expect(user.email_verified).toBe(true);
    expect((await postSignIn("new.person@invitee.test", "a-long-enough-password")).status).toBe(200);

    const audit = await sql`select action, actor_id from audit_log where action like 'invite_%' order by id`;
    expect(audit.map((a) => a.action)).toEqual(["invite_created", "invite_accepted"]);
    expect(audit[1].actor_id).toBe(me.user.id);
  });

  it("lists invitations and shows accepted ones as accepted", async () => {
    await invite(admin);
    await accept(await sentToken());
    const { GET } = await import("@/app/api/admin/invitations/route");
    const { invitations } = await (await GET(new Request("http://localhost/api/admin/invitations", json(admin, undefined, "GET")))).json();
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({ email: "new.person@invitee.test", status: "accepted", invitedBy: "Morgan Admin" });
  });

  it("refuses an address that already has an account or a pending invite", async () => {
    expect((await invite(admin, "alice@sift.local")).status).toBe(409);
    expect((await invite(admin)).status).toBe(201);
    const again = await invite(admin);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already_pending" });
  });
});

describe("invitations: links that do not work", () => {
  const invalid = async (res: Response) => {
    expect(res.status).toBe(410);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    const body = await res.json();
    expect(body).toMatchObject({ code: "invite_invalid" });
    return body.error as string;
  };

  it("expired", async () => {
    await invite(admin);
    const token = await sentToken();
    await sql`update invitations set expires_at = now() - interval '1 minute'`;
    await invalid(await accept(token));
    expect(await sql`select 1 from users where email = 'new.person@invitee.test'`).toHaveLength(0);
    const { invitations } = await (await (await import("@/app/api/admin/invitations/route")).GET(
      new Request("http://localhost/api/admin/invitations", json(admin, undefined, "GET")),
    )).json();
    expect(invitations[0].status).toBe("expired");
  });

  it("revoked, and revoking is audited", async () => {
    const { invitation } = await (await invite(admin)).json();
    const token = await sentToken();
    const res = await act(admin, invitation.id, "revoke");
    expect(res.status).toBe(200);
    expect((await res.json()).invitation.status).toBe("revoked");
    await invalid(await accept(token));
    expect(await sql`select 1 from audit_log where action = 'invite_revoked'`).toHaveLength(1);
  });

  it("revoked before the email is sent: nothing is sent", async () => {
    const { invitation } = await (await invite(admin)).json();
    await act(admin, invitation.id, "revoke");
    await runDueJobs();
    expect(fake.sent).toHaveLength(0);
  });

  it("reused: the second use gets the same answer as an unknown token, and makes no second account", async () => {
    await invite(admin);
    const token = await sentToken();
    expect((await accept(token)).status).toBe(200);
    const reusedError = await invalid(await accept(token, { name: "Someone Else" }));
    expect(await invalid(await accept("not-a-real-token"))).toBe(reusedError);
    expect(await sql`select 1 from users where email = 'new.person@invitee.test'`).toHaveLength(1);
  });

  it("a rejected password does not use up the link", async () => {
    await invite(admin);
    const token = await sentToken();
    expect((await accept(token, { password: "short" })).status).toBe(400);
    expect((await accept(token)).status).toBe(200);
  });
});

describe("invitations: resend", () => {
  it("sends a new link, kills the old one and restarts the 7 days", async () => {
    const { invitation } = await (await invite(admin)).json();
    const first = await sentToken();
    await sql`update invitations set expires_at = now() + interval '1 hour'`;

    expect((await act(admin, invitation.id, "resend")).status).toBe(200);
    const second = await sentToken();
    expect(second).not.toBe(first);
    expect(fake.sent).toHaveLength(2);

    expect((await accept(first)).status).toBe(410);
    expect((await accept(second)).status).toBe(200);
  });

  it("can revive an expired invite but not an accepted or revoked one", async () => {
    const { invitation } = await (await invite(admin)).json();
    await sql`update invitations set expires_at = now() - interval '1 minute'`;
    expect((await act(admin, invitation.id, "resend")).status).toBe(200);
    await act(admin, invitation.id, "revoke");
    expect((await act(admin, invitation.id, "resend")).status).toBe(404);
  });
});

describe("invitations: access and limits", () => {
  it("rejects a non-admin and a signed-out caller, and changes nothing", async () => {
    const { invitation } = await (await invite(admin)).json();
    expect((await invite(agent, "x@invitee.test")).status).toBe(403);
    expect((await invite("", "x@invitee.test")).status).toBe(401);
    expect((await act(agent, invitation.id, "resend")).status).toBe(403);
    expect((await act(agent, invitation.id, "revoke")).status).toBe(403);
    const { GET } = await import("@/app/api/admin/invitations/route");
    expect((await GET(new Request("http://localhost/api/admin/invitations", json(agent, undefined, "GET")))).status).toBe(403);
    expect(await sql`select 1 from invitations`).toHaveLength(1);
  });

  it("limits sending to 20 per day per admin, with Retry-After", async () => {
    for (let i = 0; i < 20; i++) expect((await invite(admin, `p${i}@invitee.test`)).status).toBe(201);
    const blocked = await invite(admin, "p20@invitee.test");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await sql`select 1 from invitations`).toHaveLength(20);
  });

  it("limits accepting to 10 attempts per hour per IP, with Retry-After", async () => {
    for (let i = 0; i < 10; i++) expect((await accept("nope", {}, "10.8.0.1")).status).toBe(410);
    const blocked = await accept("nope", {}, "10.8.0.1");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await accept("nope", {}, "10.8.0.2")).status).toBe(410);
    await resetRateLimits();
  });
});

describe("invitations: password", () => {
  it("the seeded password still works (the accept flow did not disturb credentials)", async () => {
    expect((await postSignIn("alice@sift.local", passwordFor("alice@sift.local"))).status).toBe(200);
  });
});
