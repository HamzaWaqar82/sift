import { beforeAll, describe, expect, it } from "vitest";
import { seedUsers } from "../scripts/seed.mjs";

const ADMIN_PASSWORD = "test-admin-password";
const AGENT_PASSWORD = "test-agent-password";

let ipCounter = 0;
/** Each test signs in from its own address so the in-memory rate limit never leaks between tests. */
function freshIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function signIn(email: string, password: string, ip = freshIp()) {
  const { POST } = await import("@/app/api/auth/sign-in/route");
  return POST(
    new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password }),
    }),
  );
}

/** Turns a Set-Cookie response header into a Cookie request header, as a browser would. */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

async function getMe(cookie?: string) {
  const { GET } = await import("@/app/api/me/route");
  return GET(new Request("http://localhost/api/me", { headers: cookie ? { cookie } : {} }));
}

beforeAll(async () => {
  await seedUsers(process.env.DATABASE_URL!, {
    adminPassword: ADMIN_PASSWORD,
    agentPassword: AGENT_PASSWORD,
  });
});

describe("sign-in", () => {
  it("signs an agent in and the session cookie identifies them on later requests", async () => {
    const res = await signIn("alice@sift.local", AGENT_PASSWORD);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);

    const me = await getMe(cookieFrom(res));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { email: "alice@sift.local", name: "Alice Agent", role: "agent" },
    });
  });

  it("signs the admin in with the admin role", async () => {
    const res = await signIn("Admin@Sift.local", ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    const me = await getMe(cookieFrom(res));
    expect(await me.json()).toMatchObject({ user: { email: "admin@sift.local", role: "admin" } });
  });

  it("rejects a wrong password without setting a session", async () => {
    const res = await signIn("alice@sift.local", "not-the-password");

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an unknown email with the same response as a wrong password", async () => {
    const res = await signIn("nobody@sift.local", AGENT_PASSWORD);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Incorrect email or password" });
  });

  it("does not accept one role's password for another role's account", async () => {
    const res = await signIn("admin@sift.local", AGENT_PASSWORD);

    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await signIn("", "");

    expect(res.status).toBe(400);
  });
});

describe("sign-out", () => {
  it("expires the session cookie and sends the browser to the sign-in page", async () => {
    const cookie = cookieFrom(await signIn("alice@sift.local", AGENT_PASSWORD));
    const { POST } = await import("@/app/api/auth/sign-out/route");

    const res = await POST(
      new Request("http://localhost/api/auth/sign-out", { method: "POST", headers: { cookie } }),
    );

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
    const cleared = cookieFrom(res);
    expect(cleared).toBe("sift_session=");
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await getMe(cleared)).status).toBe(401);
  });
});

describe("sign-in rate limit", () => {
  it("blocks an address after repeated failures, even with the right password", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect((await signIn("dev@sift.local", "wrong", ip)).status).toBe(401);
    }

    const blocked = await signIn("dev@sift.local", AGENT_PASSWORD, ip);

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("does not block other addresses", async () => {
    const attacker = freshIp();
    for (let i = 0; i < 6; i++) await signIn("dev@sift.local", "wrong", attacker);

    const res = await signIn("dev@sift.local", AGENT_PASSWORD, freshIp());

    expect(res.status).toBe(200);
  });

  it("clears the failure count after a successful sign-in", async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await signIn("dev@sift.local", "wrong", ip);
    expect((await signIn("dev@sift.local", AGENT_PASSWORD, ip)).status).toBe(200);

    for (let i = 0; i < 4; i++) await signIn("dev@sift.local", "wrong", ip);

    expect((await signIn("dev@sift.local", AGENT_PASSWORD, ip)).status).toBe(200);
  });
});

describe("protected routes", () => {
  it("rejects an anonymous API request with 401", async () => {
    const res = await getMe();

    expect(res.status).toBe(401);
  });

  it("rejects a forged or tampered session cookie", async () => {
    const good = cookieFrom(await signIn("alice@sift.local", AGENT_PASSWORD));
    const tampered = good.slice(0, -3) + (good.endsWith("aaa") ? "bbb" : "aaa");

    expect((await getMe(tampered)).status).toBe(401);
    expect((await getMe("sift_session=not-a-token")).status).toBe(401);
  });

  it("requireAdmin returns 403 for an agent and the user for an admin", async () => {
    const { requireAdmin } = await import("@/lib/auth");
    const agentCookie = cookieFrom(await signIn("ben@sift.local", AGENT_PASSWORD));
    const adminCookie = cookieFrom(await signIn("admin@sift.local", ADMIN_PASSWORD));
    const req = (cookie?: string) =>
      new Request("http://localhost/api/anything", { headers: cookie ? { cookie } : {} });

    const anon = await requireAdmin(req());
    const agent = await requireAdmin(req(agentCookie));
    const admin = await requireAdmin(req(adminCookie));

    expect(anon instanceof Response && anon.status).toBe(401);
    expect(agent instanceof Response && agent.status).toBe(403);
    expect(admin).toMatchObject({ email: "admin@sift.local", role: "admin" });
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
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("lets the health check, webhook and sign-in through without a session", async () => {
    for (const path of ["/api/health", "/api/webhook", "/api/webhooks/email", "/sign-in", "/api/auth/sign-in"]) {
      expect(passesThrough(await throughProxy(path)), path).toBe(true);
    }
  });

  it("does not treat look-alike paths as public", async () => {
    expect((await throughProxy("/api/healthz")).status).toBe(401);
    expect((await throughProxy("/api/webhookish")).status).toBe(401);
  });

  it("lets signed-in requests through", async () => {
    const cookie = cookieFrom(await signIn("chloe@sift.local", AGENT_PASSWORD));

    expect(passesThrough(await throughProxy("/api/tickets", cookie))).toBe(true);
    expect(passesThrough(await throughProxy("/", cookie))).toBe(true);
  });
});
