import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let alice: string;
let aliceId: number;
let benId: number;

beforeAll(async () => {
  await seedTestUsers();
  alice = await signInAs("alice@sift.local");
  aliceId = (await sql`select id from users where email = 'alice@sift.local'`)[0].id;
  benId = (await sql`select id from users where email = 'ben@sift.local'`)[0].id;
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

async function get(path: string, query = "", cookie = alice) {
  const mod = await import(`@/app/api/tickets/${path}route`);
  return mod.GET(new Request(`http://localhost/api/tickets/${path}${query}`, { headers: { cookie } }));
}
const list = async (query = "") => {
  const res = await get("", query);
  return { status: res.status, body: await res.json() };
};

type Seed = {
  subject: string;
  body?: string;
  name?: string | null;
  email?: string;
  source?: "webhook" | "form";
  status?: "open" | "replied" | "closed";
  assignee?: number | null;
  minute: number;
  triage?: { category: string; urgency: string } | "failed";
  updatedMinute?: number;
};

const T0 = new Date("2026-10-01T09:00:00.000Z").getTime();
const at = (m: number) => new Date(T0 + m * 60_000);

async function seed(rows: Seed[]) {
  const ids: number[] = [];
  let i = 0;
  for (const r of rows) {
    i++;
    const [t] = await sql`
      insert into tickets (customer_email, customer_name, subject, body, source, status, assignee_id, created_at, updated_at)
      values (${r.email ?? `c${i}@example.com`}, ${r.name ?? null}, ${r.subject}, ${r.body ?? "hello"}, ${r.source ?? "webhook"},
              ${r.status ?? "open"}, ${r.assignee ?? null}, ${at(r.minute)}, ${at(r.updatedMinute ?? r.minute)})
      returning id`;
    ids.push(t.id);
    if (r.triage === "failed") {
      await sql`insert into triage_results (ticket_id, error, model) values (${t.id}, 'boom', 'm')`;
    } else if (r.triage) {
      await sql`insert into triage_results (ticket_id, category, urgency, draft, model)
                values (${t.id}, ${r.triage.category}::triage_category, ${r.triage.urgency}::triage_urgency, 'draft', 'm')`;
    }
  }
  return ids;
}

const subjects = (body: { tickets: { subject: string }[] }) => body.tickets.map((t) => t.subject);

describe("search (q)", () => {
  beforeEach(async () => {
    await seed([
      { subject: "Invoice question", body: "Where is my receipt?", name: "Maria Gonzalez", email: "maria@brightpath.com", minute: 1 },
      { subject: "Export failing", body: "CSV download breaks", name: "Marcus Reid", email: "marcus@holloway.com", minute: 2 },
      { subject: "100% discount?", body: "promo_code with under_score and back\\slash", minute: 3 },
      { subject: "Plain", body: "nothing special", minute: 4 },
    ]);
  });

  it("matches subject, body, customer name and customer email, case-insensitively", async () => {
    expect(subjects((await list("?q=INVOICE")).body)).toEqual(["Invoice question"]);
    expect(subjects((await list("?q=csv%20download")).body)).toEqual(["Export failing"]);
    expect(subjects((await list("?q=gonzalez")).body)).toEqual(["Invoice question"]);
    expect(subjects((await list("?q=holloway.com")).body)).toEqual(["Export failing"]);
  });

  it("returns no tickets (and a null cursor) when nothing matches", async () => {
    const { status, body } = await list("?q=zzzznothing");
    expect(status).toBe(200);
    expect(body).toEqual({ tickets: [], nextCursor: null });
  });

  it("treats % _ and \\ literally", async () => {
    expect(subjects((await list("?q=%25")).body)).toEqual(["100% discount?"]);
    expect(subjects((await list("?q=_")).body)).toEqual(["100% discount?"]); // only the underscore in promo_code, not "any char"
    expect(subjects((await list("?q=%5C")).body)).toEqual(["100% discount?"]);
    expect((await list("?q=pr_mo")).body.tickets).toEqual([]);
    expect((await list("?q=n%25g")).body.tickets).toEqual([]);
  });

  it("ignores a blank q and caps a very long q at 100 characters without erroring", async () => {
    expect((await list("?q=%20%20")).body.tickets).toHaveLength(4);
    const res = await list(`?q=${"a".repeat(5000)}`);
    expect(res.status).toBe(200);
  });

  it("is safe against SQL-looking text", async () => {
    const res = await list(`?q=${encodeURIComponent("'; drop table tickets; --")}`);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect((await list()).body.tickets).toHaveLength(4);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await seed([
      { subject: "A", minute: 1, status: "open", assignee: aliceId, source: "form", triage: { category: "billing", urgency: "high" } },
      { subject: "B", minute: 2, status: "replied", assignee: benId, triage: { category: "technical", urgency: "low" } },
      { subject: "C", minute: 3, status: "closed", assignee: null, triage: "failed" },
      { subject: "D", minute: 4, status: "open", assignee: null },
      { subject: "E", minute: 5, status: "open", assignee: aliceId, triage: { category: "billing", urgency: "medium" } },
    ]);
  });
  const subj = async (q: string) => subjects((await list(q)).body).sort();

  it("status: single and comma list", async () => {
    expect(await subj("?status=closed")).toEqual(["C"]);
    expect(await subj("?status=open,replied")).toEqual(["A", "B", "D", "E"]);
  });
  it("assignee: me, unassigned, user id", async () => {
    expect(await subj("?assignee=me")).toEqual(["A", "E"]);
    expect(await subj("?assignee=unassigned")).toEqual(["C", "D"]);
    expect(await subj(`?assignee=${benId}`)).toEqual(["B"]);
    expect(await subj("?assignee=99999")).toEqual([]);
  });
  it("category and urgency use the latest VALID triage; untriaged and failed never match", async () => {
    expect(await subj("?category=billing")).toEqual(["A", "E"]);
    expect(await subj("?category=billing,technical")).toEqual(["A", "B", "E"]);
    expect(await subj("?urgency=high")).toEqual(["A"]);
    expect(await subj("?category=billing&urgency=medium")).toEqual(["E"]);
  });
  it("a later failed triage does not hide the earlier valid category", async () => {
    await sql`insert into triage_results (ticket_id, error, model) select id, 'later failure', 'm' from tickets where subject = 'A'`;
    expect(await subj("?category=billing")).toEqual(["A", "E"]);
  });
  it("source", async () => {
    expect(await subj("?source=form")).toEqual(["A"]);
    expect(await subj("?source=webhook")).toEqual(["B", "C", "D", "E"]);
  });
  it("combines filters and search", async () => {
    expect(await subj("?assignee=me&status=open&q=hello")).toEqual(["A", "E"]);
  });
  it("rejects invalid values with 400 and field messages", async () => {
    for (const [q, field] of [
      ["?status=nope", "status"],
      ["?status=open,nope", "status"],
      ["?assignee=bob", "assignee"],
      ["?category=x", "category"],
      ["?urgency=x", "urgency"],
      ["?source=x", "source"],
      ["?sort=sideways", "sort"],
      ["?limit=0", "limit"],
      ["?limit=101", "limit"],
      ["?limit=abc", "limit"],
      ["?limit=-5", "limit"],
      ["?limit=1.5", "limit"],
    ] as const) {
      const { status, body } = await list(q);
      expect(status, q).toBe(400);
      expect(body.code).toBe("validation_failed");
      expect(body.fields[field], q).toBeTruthy();
    }
  });
  it("rejects a malformed cursor, and a cursor from another sort", async () => {
    for (const c of ["garbage", "e30", Buffer.from('["newest","nope",1]').toString("base64url"), Buffer.from('["newest","2026-01-01T00:00:00Z",99999999999]').toString("base64url")]) {
      const { status, body } = await list(`?cursor=${c}`);
      expect(status, c).toBe(400);
      expect(body.code).toBe("invalid_cursor");
    }
    const page = await list("?limit=2");
    expect((await list(`?sort=oldest&cursor=${page.body.nextCursor}`)).status).toBe(400);
  });
});

describe("sort and keyset paging", () => {
  async function walk(query: string, limit: number) {
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const { status, body } = await list(`?${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
      expect(status).toBe(200);
      seen.push(...body.tickets.map((t: { id: number }) => t.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    return seen;
  }

  // 25 tickets; minutes collide in groups of 5 (same created_at) to exercise the id tiebreak.
  // updated order differs from created order.
  let ids: number[];
  beforeEach(async () => {
    ids = await seed(
      Array.from({ length: 25 }, (_, i) => ({
        subject: `S${i}`,
        minute: Math.floor(i / 5),
        updatedMinute: (i * 7) % 6,
      })),
    );
  });

  it("default is newest first, 20 per page", async () => {
    const { body } = await list();
    expect(body.tickets).toHaveLength(20);
    expect(body.nextCursor).toBeTruthy();
    expect(body.tickets[0].id).toBe(ids[24]);
  });

  it("newest: pages cover every ticket exactly once, in order", async () => {
    const seen = await walk("sort=newest", 7);
    expect(seen).toEqual([...ids].reverse());
  });

  it("oldest: pages cover every ticket exactly once, in order", async () => {
    expect(await walk("sort=oldest", 6)).toEqual(ids);
  });

  it("updated: ordered by updated_at desc then id desc, no dupes or gaps", async () => {
    const rows = await sql`select id from tickets order by updated_at desc, id desc`;
    const expected = rows.map((r) => r.id);
    const seen = await walk("sort=updated", 4);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(25);
  });

  it("paging with filters stays correct", async () => {
    const seen = await walk("sort=oldest&q=S1", 3); // S1, S10..S19
    expect(seen).toHaveLength(11);
    expect(new Set(seen).size).toBe(11);
  });

  it("limit caps at 100 and an exact fit yields no next cursor", async () => {
    const { body } = await list("?limit=25");
    expect(body.tickets).toHaveLength(25);
    expect(body.nextCursor).toBeNull();
  });
});

describe("board", () => {
  beforeEach(async () => {
    await seed([
      ...Array.from({ length: 7 }, (_, i) => ({ subject: `open${i}`, minute: i, status: "open" as const, assignee: i % 2 ? aliceId : null })),
      ...Array.from({ length: 3 }, (_, i) => ({ subject: `rep${i}`, minute: 10 + i, status: "replied" as const, assignee: aliceId })),
      { subject: "done0", minute: 20, status: "closed" as const },
    ]);
  });
  const board = async (q = "") => {
    const res = await get("board/", q);
    return { status: res.status, body: await res.json() };
  };

  it("groups by status with counts, first page and a per-column cursor", async () => {
    const { status, body } = await board("?limit=3");
    expect(status).toBe(200);
    expect(Object.keys(body.columns).sort()).toEqual(["closed", "open", "replied"]);
    expect(body.columns.open.count).toBe(7);
    expect(subjects(body.columns.open)).toEqual(["open6", "open5", "open4"]);
    expect(body.columns.open.nextCursor).toBeTruthy();
    expect(body.columns.replied).toMatchObject({ count: 3, nextCursor: null });
    expect(body.columns.closed.count).toBe(1);
  });

  it("loads more of one column with column + cursor, to the end without dupes", async () => {
    const first = await board("?limit=3");
    let cursor: string | null = first.body.columns.open.nextCursor;
    const all = subjects(first.body.columns.open);
    while (cursor) {
      const { status, body } = await board(`?limit=3&column=open&cursor=${cursor}`);
      expect(status).toBe(200);
      expect(Object.keys(body.columns)).toEqual(["open"]);
      expect(body.columns.open.count).toBe(7);
      all.push(...subjects(body.columns.open));
      cursor = body.columns.open.nextCursor;
    }
    expect(all).toEqual(["open6", "open5", "open4", "open3", "open2", "open1", "open0"]);
  });

  it("applies filters, search and sort to every column and its counts", async () => {
    const { body } = await board("?assignee=me&sort=oldest");
    expect(body.columns.open.count).toBe(3);
    expect(subjects(body.columns.open)).toEqual(["open1", "open3", "open5"]);
    expect(body.columns.replied.count).toBe(3);
    expect(body.columns.closed.count).toBe(0);
    const q = await board("?q=rep");
    expect(q.body.columns.open.count).toBe(0);
    expect(subjects(q.body.columns.replied)).toEqual(["rep2", "rep1", "rep0"]);
  });

  it("a status filter limits the columns", async () => {
    const { body } = await board("?status=open,closed");
    expect(Object.keys(body.columns).sort()).toEqual(["closed", "open"]);
  });

  it("validates its params", async () => {
    expect((await board("?limit=51")).status).toBe(400);
    expect((await board("?column=nope")).status).toBe(400);
    expect((await board("?cursor=abc")).status).toBe(400); // cursor needs column
    expect((await board("?column=open&cursor=abc")).status).toBe(400);
  });

  it("requires sign-in", async () => {
    expect((await get("board/", "", "")).status).toBe(401);
  });
});

describe("summary", () => {
  beforeEach(async () => {
    await seed([
      { subject: "a", minute: 1, status: "open", assignee: aliceId, body: "refund please" },
      { subject: "b", minute: 2, status: "open", assignee: null, body: "refund please" },
      { subject: "c", minute: 3, status: "replied", assignee: aliceId },
      { subject: "d", minute: 4, status: "closed", assignee: aliceId, body: "refund please" },
    ]);
  });
  const summary = async (q = "") => {
    const res = await get("summary/", q);
    return { status: res.status, body: await res.json() };
  };

  it("returns total and counts by status, with zeros for empty statuses", async () => {
    expect((await summary()).body).toEqual({ total: 4, byStatus: { open: 2, replied: 1, closed: 1 } });
    expect((await summary("?q=nothingmatches")).body).toEqual({ total: 0, byStatus: { open: 0, replied: 0, closed: 0 } });
  });

  it("honours q and assignee, and ignores status", async () => {
    expect((await summary("?q=refund")).body).toEqual({ total: 3, byStatus: { open: 2, replied: 0, closed: 1 } });
    expect((await summary("?assignee=me")).body).toEqual({ total: 3, byStatus: { open: 1, replied: 1, closed: 1 } });
    expect((await summary("?assignee=unassigned&status=closed")).body).toEqual({ total: 1, byStatus: { open: 1, replied: 0, closed: 0 } });
  });

  it("validates params and requires sign-in", async () => {
    expect((await summary("?assignee=bob")).status).toBe(400);
    expect((await get("summary/", "", "")).status).toBe(401);
  });
});
