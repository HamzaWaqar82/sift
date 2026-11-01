import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUsers } from "../scripts/seed.mjs";
import { postSignIn, resetRateLimits, seedTestUsers, sessionCookieFrom, TEST_ORIGIN, TEST_PASSWORDS } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });

let ipCounter = 0;
/** Each test signs in from its own address so per-IP counters never leak between tests. */
function freshIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function signIn(email: string, password: string, ip = freshIp(), headers: Record<string, string> = {}) {
  return postSignIn(email, password, { "x-forwarded-for": ip, ...headers });
}

async function getMe(cookie?: string) {
  const { GET } = await import("@/app/api/me/route");
  return GET(new Request("http://localhost/api/me", { headers: cookie ? { cookie } : {} }));
}

async function postForm(path: "sign-out" | "sign-out-everywhere", cookie?: string) {
  const { POST } =
    path === "sign-out"
      ? await import("@/app/api/auth/sign-out/route")
      : await import("@/app/api/auth/sign-out-everywhere/route");
  return POST(
    new Request(`http://localhost/api/auth/${path}`, {
      method: "POST",
      headers: cookie ? { cookie, origin: TEST_ORIGIN } : { origin: TEST_ORIGIN },
    }),
  );
}

const userId = async (email: string) => (await sql`select id from users where email = ${email}`)[0].id as number;

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await seedTestUsers();
  await sql.end();
});

describe("sign-in", () => {
  it("signs an agent in and the session cookie identifies them on later requests", async () => {
    const res = await signIn("alice@sift.local", TEST_PASSWORDS.alice);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: await userId("alice@sift.local"), email: "alice@sift.local", name: "Alice Agent", role: "agent" },
    });
    const me = await getMe(sessionCookieFrom(res));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { email: "alice@sift.local", name: "Alice Agent", role: "agent" },
    });
  });

  it("sets an httpOnly, SameSite=Lax session cookie backed by a 7-day database session", async () => {
    const res = await signIn("chloe@sift.local", TEST_PASSWORDS.chloe);

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("sift.session_token="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=604800/i);
    const [row] = await sql`
      select expires_at from session where user_id = ${await userId("chloe@sift.local")}
      order by id desc limit 1`;
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("signs the admin in with the admin role", async () => {
    const res = await signIn("Admin@Sift.local", TEST_PASSWORDS.admin);

    expect(res.status).toBe(200);
    const me = await getMe(sessionCookieFrom(res));
    expect(await me.json()).toMatchObject({ user: { email: "admin@sift.local", role: "admin" } });
  });

  it("rejects a wrong password without setting a session", async () => {
    const res = await signIn("alice@sift.local", "not-the-password");

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an unknown email with the same response as a wrong password", async () => {
    const res = await signIn("nobody@sift.local", TEST_PASSWORDS.alice);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Incorrect email or password", code: "invalid_credentials" });
  });

  it("does not accept one role's password for another role's account", async () => {
    const res = await signIn("admin@sift.local", TEST_PASSWORDS.alice);

    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await signIn("", "");

    expect(res.status).toBe(400);
  });

  it("rejects a sign-in posted from another site", async () => {
    const res = await signIn("alice@sift.local", TEST_PASSWORDS.alice, freshIp(), {
      origin: "https://evil.example",
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("records failed sign-ins in the audit log", async () => {
    const ip = freshIp();
    await signIn("ben@sift.local", "wrong", ip);
    await signIn("ghost@sift.local", "wrong", ip);

    const rows = await sql`
      select target_user_id, metadata from audit_log
      where action = 'sign_in_failed' and metadata->>'ip' = ${ip} order by id`;
    expect(rows.map((r) => [r.target_user_id, r.metadata.email])).toEqual([
      [await userId("ben@sift.local"), "ben@sift.local"],
      [null, "ghost@sift.local"],
    ]);
  });
});

describe("seed", () => {
  it("gives every account its own password, not shared with any other account", async () => {
    for (const [name, password] of Object.entries(TEST_PASSWORDS)) {
      expect((await signIn(`${name}@sift.local`, password)).status, name).toBe(200);
    }
    expect((await signIn("ben@sift.local", TEST_PASSWORDS.alice)).status).toBe(401);
    expect((await signIn("chloe@sift.local", TEST_PASSWORDS.dev)).status).toBe(401);
  });

  it("is idempotent: one verified user and one credential account per seeded email", async () => {
    await seedTestUsers();
    await seedTestUsers();

    const rows = await sql`
      select u.email, u.email_verified, count(a.id)::int as accounts
      from users u left join account a on a.user_id = u.id and a.provider_id = 'credential' and a.account_id = u.id::text
      where u.email like '%@sift.local' group by u.id order by u.email`;
    expect(rows).toHaveLength(5);
    for (const r of rows) expect([r.email, r.email_verified, r.accounts]).toEqual([r.email, true, 1]);
  });

  it("re-seeding with a changed password updates the existing user's hash", async () => {
    try {
      await seedUsers(process.env.DATABASE_URL!, { ...TEST_PASSWORDS, ben: "rotated-ben-password" });

      expect((await signIn("ben@sift.local", "rotated-ben-password")).status).toBe(200);
      expect((await signIn("ben@sift.local", TEST_PASSWORDS.ben)).status).toBe(401);
      expect((await signIn("alice@sift.local", TEST_PASSWORDS.alice)).status).toBe(200);
    } finally {
      await seedTestUsers();
    }
  });

  it("refuses to seed when any account's password is missing, naming its variable", async () => {
    const { chloe: _omitted, ...rest } = TEST_PASSWORDS;
    await expect(seedUsers(process.env.DATABASE_URL!, rest)).rejects.toThrow(/SEED_PASSWORD_CHLOE/);
  });
});

describe("sign-out", () => {
  it("ends the session, expires the cookie and sends the browser to the sign-in page", async () => {
    const cookie = sessionCookieFrom(await signIn("alice@sift.local", TEST_PASSWORDS.alice));

    const res = await postForm("sign-out", cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/sign-in");
    expect(res.headers.get("set-cookie")).toMatch(/^sift\.session_token=;.*Max-Age=0/i);
    // The old cookie is dead even if a browser kept it.
    expect((await getMe(cookie)).status).toBe(401);
  });

  it("signs a user out everywhere, leaving other users signed in", async () => {
    const laptop = sessionCookieFrom(await signIn("ben@sift.local", TEST_PASSWORDS.ben));
    const phone = sessionCookieFrom(await signIn("ben@sift.local", TEST_PASSWORDS.ben));
    const alice = sessionCookieFrom(await signIn("alice@sift.local", TEST_PASSWORDS.alice));

    const res = await postForm("sign-out-everywhere", phone);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/sign-in");
    expect((await getMe(laptop)).status).toBe(401);
    expect((await getMe(phone)).status).toBe(401);
    expect((await getMe(alice)).status).toBe(200);
    const ben = await userId("ben@sift.local");
    const [audit] = await sql`
      select actor_id, target_user_id, metadata from audit_log
      where action = 'sessions_revoked' order by id desc limit 1`;
    expect(audit).toMatchObject({ actor_id: ben, target_user_id: ben, metadata: { reason: "sign_out_everywhere" } });
    expect(audit.metadata.sessions).toBeGreaterThanOrEqual(2);
  });

  it("refuses sign-out-everywhere without a session", async () => {
    expect((await postForm("sign-out-everywhere")).status).toBe(401);
  });
});

describe("sessions", () => {
  it("rejects a session past its 7-day expiry", async () => {
    const cookie = sessionCookieFrom(await signIn("dev@sift.local", TEST_PASSWORDS.dev));
    await sql`
      update session set expires_at = now() - interval '1 second'
      where id = (select max(id) from session where user_id = ${await userId("dev@sift.local")})`;

    expect((await getMe(cookie)).status).toBe(401);
  });

  it("rejects a deactivated user's existing session and their next sign-in", async () => {
    const cookie = sessionCookieFrom(await signIn("chloe@sift.local", TEST_PASSWORDS.chloe));
    try {
      await sql`update users set deactivated_at = now() where email = 'chloe@sift.local'`;

      expect((await getMe(cookie)).status).toBe(401);
      const again = await signIn("chloe@sift.local", TEST_PASSWORDS.chloe);
      expect(again.status).toBe(401);
      expect(await again.json()).toEqual({ error: "Incorrect email or password", code: "invalid_credentials" });
      expect(again.headers.get("set-cookie")).toBeNull();
    } finally {
      await sql`update users set deactivated_at = null where email = 'chloe@sift.local'`;
    }
  });
});

// Each test runs several bcrypt checks; allow for a loaded CI machine.
describe("sign-in rate limit", { timeout: 60_000 }, () => {
  beforeEach(resetRateLimits);

  it("blocks an address after 5 failures, even with the right password", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect((await signIn(`user${i}@sift.local`, "wrong", ip)).status).toBe(401);
    }

    const blocked = await signIn("dev@sift.local", TEST_PASSWORDS.dev, ip);

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("blocks an email after 5 failures from different addresses", async () => {
    for (let i = 0; i < 5; i++) await signIn("dev@sift.local", "wrong", freshIp());

    const blocked = await signIn("dev@sift.local", TEST_PASSWORDS.dev, freshIp());

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn("alice@sift.local", TEST_PASSWORDS.alice, freshIp())).status).toBe(200);
  });

  it("limits unknown emails exactly like known ones", async () => {
    for (let i = 0; i < 5; i++) await signIn("nobody@sift.local", "wrong", freshIp());

    expect((await signIn("nobody@sift.local", "wrong", freshIp())).status).toBe(429);
  });

  it("keeps counting across an app restart", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await signIn("dev@sift.local", "wrong", ip);

    vi.resetModules(); // a fresh copy of every module, as after a restart

    expect((await signIn("dev@sift.local", TEST_PASSWORDS.dev, ip)).status).toBe(429);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await signIn("dev@sift.local", "wrong", ip);
    await sql`update rate_limits set window_start = now() - interval '16 minutes'`;

    expect((await signIn("dev@sift.local", TEST_PASSWORDS.dev, ip)).status).toBe(200);
  });

  it("clears the failure count after a successful sign-in", async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await signIn("dev@sift.local", "wrong", ip);
    expect((await signIn("dev@sift.local", TEST_PASSWORDS.dev, ip)).status).toBe(200);

    for (let i = 0; i < 4; i++) await signIn("dev@sift.local", "wrong", ip);

    expect((await signIn("dev@sift.local", TEST_PASSWORDS.dev, ip)).status).toBe(200);
  });
});

describe("protected routes", () => {
  it("rejects an anonymous API request with 401", async () => {
    const res = await getMe();

    expect(res.status).toBe(401);
  });

  it("rejects a forged or tampered session cookie", async () => {
    const good = sessionCookieFrom(await signIn("alice@sift.local", TEST_PASSWORDS.alice));
    const tampered = good.slice(0, -3) + (good.endsWith("aaa") ? "bbb" : "aaa");

    expect((await getMe(tampered)).status).toBe(401);
    expect((await getMe("sift.session_token=not-a-token")).status).toBe(401);
  });

  it("requireAdmin returns 403 for an agent and the user for an admin", async () => {
    const { requireAdmin } = await import("@/lib/auth");
    const agentCookie = sessionCookieFrom(await signIn("ben@sift.local", TEST_PASSWORDS.ben));
    const adminCookie = sessionCookieFrom(await signIn("admin@sift.local", TEST_PASSWORDS.admin));
    const req = (cookie?: string) =>
      new Request("http://localhost/api/anything", { headers: cookie ? { cookie } : {} });

    const anon = await requireAdmin(req());
    const agent = await requireAdmin(req(agentCookie));
    const admin = await requireAdmin(req(adminCookie));

    expect(anon instanceof Response && anon.status).toBe(401);
    expect(agent instanceof Response && agent.status).toBe(403);
    expect(admin).toMatchObject({ id: await userId("admin@sift.local"), email: "admin@sift.local", role: "admin" });
  });
});

describe("proxy (runs before every page and API route)", () => {
  async function throughProxy(path: string, cookie?: string) {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }));
  }
  const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

  it("returns 401 JSON for anonymous API requests", async () => {
    const res = await throughProxy("/api/tickets");

    expect(res.status).toBe(401);
  });

  it("redirects anonymous page requests to the sign-in page", async () => {
    const res = await throughProxy("/tickets?status=open");

    expect(res.status).toBe(307);
    // Same host as the request; Next's proxy adapter turns it into a relative "/sign-in".
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("lets the health check, webhook and sign-in through without a session", async () => {
    for (const path of ["/api/health", "/api/webhook", "/sign-in", "/api/auth/sign-in/email"]) {
      expect(passesThrough(await throughProxy(path)), path).toBe(true);
    }
  });

  it("does not treat look-alike paths as public", async () => {
    expect((await throughProxy("/api/healthz")).status).toBe(401);
    expect((await throughProxy("/api/webhookish")).status).toBe(401);
    // There is no /api/webhooks route, so nothing under it is public.
    expect((await throughProxy("/api/webhooks")).status).toBe(401);
    expect((await throughProxy("/api/webhooks/email")).status).toBe(401);
  });

  it("lets requests carrying a session cookie through (the guards validate it)", async () => {
    const cookie = sessionCookieFrom(await signIn("chloe@sift.local", TEST_PASSWORDS.chloe));

    expect(passesThrough(await throughProxy("/api/tickets", cookie))).toBe(true);
    expect(passesThrough(await throughProxy("/", cookie))).toBe(true);
    expect(passesThrough(await throughProxy("/", "__Secure-sift.session_token=x"))).toBe(true);
  });
});
