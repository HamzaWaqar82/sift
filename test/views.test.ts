import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let alice: string;
let ben: string;

beforeAll(async () => {
  await seedTestUsers();
  alice = await signInAs("alice@sift.local");
  ben = await signInAs("ben@sift.local");
});
beforeEach(async () => {
  await sql`truncate saved_views restart identity`;
});
afterAll(async () => {
  await sql.end();
});

const json = { "content-type": "application/json" };

async function create(body: unknown, cookie = alice) {
  const { POST } = await import("@/app/api/views/route");
  return POST(new Request("http://localhost/api/views", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify(body) }));
}
async function list(cookie = alice) {
  const { GET } = await import("@/app/api/views/route");
  return GET(new Request("http://localhost/api/views", { headers: cookie ? { cookie } : {} }));
}
async function rename(id: number | string, body: unknown, cookie = alice) {
  const { PATCH } = await import("@/app/api/views/[id]/route");
  return PATCH(new Request(`http://localhost/api/views/${id}`, { method: "PATCH", headers: { ...json, cookie }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  });
}
async function remove(id: number | string, cookie = alice) {
  const { DELETE } = await import("@/app/api/views/[id]/route");
  return DELETE(new Request(`http://localhost/api/views/${id}`, { method: "DELETE", headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

describe("saved views API", () => {
  it("saves a view with its list state, dropping defaults, and lists it for its owner only", async () => {
    const res = await create({ name: "  My urgent  ", params: { view: "table", status: "open", urgency: "high", sort: "newest", limit: "50" } });
    expect(res.status).toBe(201);
    const { view } = await res.json();
    expect(view).toMatchObject({ name: "My urgent", params: { view: "table", status: "open", urgency: "high", limit: "50" } });
    expect(view.params.sort).toBeUndefined();

    expect((await (await list()).json()).views).toHaveLength(1);
    expect((await (await list(ben)).json()).views).toHaveLength(0);
  });

  it("requires a session", async () => {
    expect((await list("")).status).toBe(401);
  });

  it("validates the name and every filter like the list API", async () => {
    for (const body of [
      { name: "", params: {} },
      { name: "x".repeat(41), params: {} },
      { name: "Bad status", params: { status: "pending" } },
      { name: "Bad view", params: { view: "kanban" } },
      { name: "Bad limit", params: { limit: "7" } },
      { name: "Unknown key", params: { colour: "red" } },
      { name: "Extra", params: {}, owner: 2 },
    ]) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    }
  });

  it("refuses a duplicate name (any case) with 409", async () => {
    await create({ name: "Billing", params: { category: "billing" } });
    const res = await create({ name: "billing", params: {} });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("name_taken");
    // Another user may use the same name.
    expect((await create({ name: "Billing", params: {} }, ben)).status).toBe(201);
  });

  it("caps each user at 20 views", async () => {
    for (let i = 0; i < 20; i++) expect((await create({ name: `View ${i}`, params: {} })).status).toBe(201);
    const res = await create({ name: "One too many", params: {} });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("view_limit");
    expect((await create({ name: "Ben's", params: {} }, ben)).status).toBe(201);
  });

  it("renames and deletes only the owner's views (others get 404)", async () => {
    const { view } = await (await create({ name: "Mine", params: {} })).json();
    expect((await rename(view.id, { name: "Stolen" }, ben)).status).toBe(404);
    expect((await remove(view.id, ben)).status).toBe(404);

    const renamed = await rename(view.id, { name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).view.name).toBe("Renamed");

    await create({ name: "Other", params: {} });
    expect((await rename(view.id, { name: "OTHER" })).status).toBe(409);

    expect((await remove(view.id)).status).toBe(200);
    expect((await remove(view.id)).status).toBe(404);
    expect((await rename("abc", { name: "x" })).status).toBe(404);
  });
});
