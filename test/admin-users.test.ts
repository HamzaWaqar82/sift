import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { passwordFor, postSignIn, seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let admin: string;
let agent: string;

beforeEach(async () => {
  await seedTestUsers();
  await sql`update users set role = 'agent', availability = 'available' where email <> 'admin@sift.local'`;
  await sql`delete from audit_log`;
  admin = await signInAs("admin@sift.local");
  agent = await signInAs("alice@sift.local");
});
afterAll(async () => {
  await sql.end();
});

async function userId(email: string) {
  const [row] = await sql`select id from users where email = ${email}`;
  return row.id as number;
}

async function call(path: string, cookie: string, init: { method?: string; body?: unknown } = {}) {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = new Request(`http://localhost${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", cookie },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const m = path.match(/^\/api\/admin\/users\/([^/]+)\/(role|deactivate|reactivate)$/);
  if (m?.[2] === "role") return (await import("@/app/api/admin/users/[id]/role/route")).POST(req, ctx(m[1]));
  if (m?.[2] === "deactivate") return (await import("@/app/api/admin/users/[id]/deactivate/route")).POST(req, ctx(m[1]));
  if (m) return (await import("@/app/api/admin/users/[id]/reactivate/route")).POST(req, ctx(m[1]));
  if (path.startsWith("/api/admin/audit")) return (await import("@/app/api/admin/audit/route")).GET(req);
  return (await import("@/app/api/admin/users/route")).GET(req);
}

const me = async (cookie: string) => {
  const { GET } = await import("@/app/api/me/route");
  return GET(new Request("http://localhost/api/me", { headers: { cookie } }));
};

describe("admin user management: access", () => {
  it("rejects an agent with 403 on every admin action, and changes nothing", async () => {
    const ben = await userId("ben@sift.local");
    const attempts: [string, { method?: string; body?: unknown }][] = [
      ["/api/admin/users", { method: "GET" }],
      [`/api/admin/users/${ben}/role`, { body: { role: "admin" } }],
      [`/api/admin/users/${ben}/deactivate`, {}],
      [`/api/admin/users/${ben}/reactivate`, {}],
      ["/api/admin/audit", { method: "GET" }],
    ];
    for (const [path, init] of attempts) expect((await call(path, agent, init)).status, path).toBe(403);

    const [row] = await sql`select role, deactivated_at from users where id = ${ben}`;
    expect(row.role).toBe("agent");
    expect(row.deactivated_at).toBeNull();
    expect(await sql`select 1 from audit_log where action in ('role_changed','user_deactivated')`).toHaveLength(0);
  });

  it("rejects signed-out callers with 401", async () => {
    expect((await call("/api/admin/users", "", { method: "GET" })).status).toBe(401);
  });
});

describe("admin user management: list", () => {
  it("shows role, availability and active status", async () => {
    const ben = await userId("ben@sift.local");
    await sql`update users set availability = 'away', deactivated_at = now() where id = ${ben}`;
    const { users } = await (await call("/api/admin/users", admin, { method: "GET" })).json();
    const row = users.find((u: { id: number }) => u.id === ben);
    expect(row).toMatchObject({ role: "agent", availability: "away", active: false });
    expect(users.find((u: { email: string }) => u.email === "admin@sift.local")).toMatchObject({ role: "admin", active: true });
  });
});

describe("admin user management: role change", () => {
  it("changes the role, revokes that user's sessions and audits it", async () => {
    const alice = await userId("alice@sift.local");
    expect((await me(agent)).status).toBe(200);

    const res = await call(`/api/admin/users/${alice}/role`, admin, { body: { role: "admin" } });
    expect(res.status).toBe(200);
    expect((await res.json()).user.role).toBe("admin");

    expect((await me(agent)).status).toBe(401);
    expect(await sql`select 1 from session where user_id = ${alice}`).toHaveLength(0);
    // She can sign in again and now has the new role.
    const again = await signInAs("alice@sift.local");
    expect((await (await me(again)).json()).user.role).toBe("admin");

    const [entry] = await sql`select actor_id, metadata from audit_log where action = 'role_changed'`;
    expect(entry.metadata).toEqual({ from: "agent", to: "admin" });
    expect(entry.actor_id).toBe(await userId("admin@sift.local"));
  });

  it("leaves sessions alone when the role is unchanged, and rejects bad roles", async () => {
    const alice = await userId("alice@sift.local");
    expect((await call(`/api/admin/users/${alice}/role`, admin, { body: { role: "agent" } })).status).toBe(200);
    expect((await me(agent)).status).toBe(200);
    expect((await call(`/api/admin/users/${alice}/role`, admin, { body: { role: "root" } })).status).toBe(400);
  });

  it("refuses to change your own role, and 404s an unknown user", async () => {
    const self = await userId("admin@sift.local");
    expect((await call(`/api/admin/users/${self}/role`, admin, { body: { role: "agent" } })).status).toBe(400);
    expect((await me(admin)).status).toBe(200);
    expect((await call("/api/admin/users/99999/role", admin, { body: { role: "agent" } })).status).toBe(404);
  });
});

describe("admin user management: deactivation", () => {
  it("revokes sessions, sets Away, blocks sign-in, keeps the row, and can be reversed", async () => {
    const alice = await userId("alice@sift.local");
    const res = await call(`/api/admin/users/${alice}/deactivate`, admin);
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ active: false, availability: "away" });

    expect((await me(agent)).status).toBe(401);
    expect(await sql`select 1 from session where user_id = ${alice}`).toHaveLength(0);
    expect((await postSignIn("alice@sift.local", passwordFor("alice@sift.local"))).status).toBe(401);
    expect(await sql`select 1 from users where id = ${alice}`).toHaveLength(1);
    expect(await sql`select 1 from audit_log where action = 'user_deactivated' and target_user_id = ${alice}`).toHaveLength(1);

    expect((await call(`/api/admin/users/${alice}/reactivate`, admin)).status).toBe(200);
    expect((await me(await signInAs("alice@sift.local"))).status).toBe(200);
    expect(await sql`select 1 from audit_log where action = 'user_reactivated'`).toHaveLength(1);
  });

  it("refuses to deactivate yourself", async () => {
    const self = await userId("admin@sift.local");
    expect((await call(`/api/admin/users/${self}/deactivate`, admin)).status).toBe(400);
    expect((await me(admin)).status).toBe(200);
  });
});

describe("admin audit log", () => {
  it("lists entries newest first with names, and pages with before", async () => {
    const ben = await userId("ben@sift.local");
    await call(`/api/admin/users/${ben}/role`, admin, { body: { role: "admin" } });
    await call(`/api/admin/users/${ben}/deactivate`, admin);

    const { entries } = await (await call("/api/admin/audit?limit=2", admin, { method: "GET" })).json();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ action: "sessions_revoked", target: expect.any(String) });
    const names = entries.map((e: { actor: string }) => e.actor);
    expect(names).toContain(entries[0].actor);

    const older = await (await call(`/api/admin/audit?before=${entries[1].id}`, admin, { method: "GET" })).json();
    expect(older.entries.every((e: { id: number }) => e.id < entries[1].id)).toBe(true);
    expect(older.entries.map((e: { action: string }) => e.action)).toContain("role_changed");
  });
});
