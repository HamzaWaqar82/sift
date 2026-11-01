import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles, seedSampleTickets } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs, triageViaApi } from "./helpers";

vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const SECRET = "test-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let alice: string;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  alice = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage, jobs`;
  provider.mockReset();
});
afterAll(async () => {
  await sql.end();
});

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function createViaForm(body: Record<string, string>) {
  const { POST } = await import("@/app/api/tickets/route");
  const res = await POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()).ticket.id as number;
}

async function postWebhook(body: unknown) {
  const { POST } = await import("@/app/api/webhook/route");
  return POST(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: JSON.stringify(body),
    }),
  );
}

async function reply(id: number, body: string, idempotencyKey = crypto.randomUUID()) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice },
      body: JSON.stringify({ body, idempotencyKey }),
    }),
    ctx(id),
  );
}

async function search(q: string, extra = "") {
  const { GET } = await import("@/app/api/tickets/route");
  const res = await GET(new Request(`http://localhost/api/tickets?q=${encodeURIComponent(q)}${extra}`, { headers: { cookie: alice } }));
  return (await res.json()) as { tickets: { id: number; subject: string }[]; nextCursor: string | null };
}

/** A later customer message, as threading (ticket 10) will append it. */
async function appendInbound(ticketId: number, body: string, at: Date) {
  await sql`insert into messages (ticket_id, direction, from_address, subject, body_text, occurred_at)
            values (${ticketId}, 'inbound', 'cust@example.com', 'Re: follow-up', ${body}, ${at})`;
}

const messagesOf = (id: number) => sql`select * from messages where ticket_id = ${id} order by occurred_at, id`;

describe("writes go to messages as well as the old fields", () => {
  it("a form ticket gets its body as the first inbound message and sets last_inbound_at", async () => {
    const id = await createViaForm({ customerEmail: "cust@example.com", subject: "Export failing", body: "My CSV export fails." });

    const [t] = await sql`select * from tickets where id = ${id}`;
    expect(t.body).toBe("My CSV export fails.");
    expect(t.last_inbound_at.toISOString()).toBe(t.created_at.toISOString());
    expect(t.last_outbound_at).toBeNull();
    const msgs = await messagesOf(id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direction: "inbound",
      author_id: null,
      from_address: "cust@example.com",
      subject: "Export failing",
      body_text: "My CSV export fails.",
      message_id: null,
      status: null,
    });
  });

  it("a webhook email stores its message id once, however often it is delivered", async () => {
    const email = { from: { email: "dana@example.com", name: "Dana" }, subject: "Locked out", body: "Cannot sign in.", message_id: "<abc@mail>" };
    const first = await postWebhook(email);
    await postWebhook(email);

    const { ticket } = await first.json();
    const msgs = await messagesOf(ticket.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "inbound", message_id: "<abc@mail>", body_text: "Cannot sign in." });
    expect(Number((await sql`select count(*) from messages`)[0].count)).toBe(1);
  });

  it("the sample seed writes each sample email as a message too", async () => {
    const n = await seedSampleTickets(process.env.DATABASE_URL!);
    await seedSampleTickets(process.env.DATABASE_URL!);
    const [{ count }] = await sql`select count(*) from messages where direction = 'inbound'`;
    expect(Number(count)).toBe(n);
    const [missing] = await sql`select count(*) from tickets where last_inbound_at is null`;
    expect(Number(missing.count)).toBe(0);
  });

  it("a sent reply is a sent outbound message with the same idempotency key; a repeat adds nothing", async () => {
    const id = await createViaForm({ customerEmail: "cust@example.com", subject: "Export failing", body: "My CSV export fails." });
    const key = crypto.randomUUID();
    expect((await reply(id, "Try again now.", key)).status).toBe(201);
    expect((await reply(id, "Try again now.", key)).status).toBe(200);

    const [r] = await sql`select * from replies where ticket_id = ${id}`;
    const out = (await messagesOf(id)).filter((m) => m.direction === "outbound");
    expect(out).toHaveLength(1);
    const [aliceRow] = await sql`select id from users where email = 'alice@sift.local'`;
    expect(out[0]).toMatchObject({
      author_id: aliceRow.id,
      to_address: "cust@example.com",
      body_text: "Try again now.",
      status: "sent",
      idempotency_key: key,
      ai_draft: null,
      edited: true,
    });
    const [t] = await sql`select * from tickets where id = ${id}`;
    expect(t.status).toBe("replied");
    expect(t.last_outbound_at.toISOString()).toBe(r.sent_at.toISOString());
  });
});

describe("conversation", () => {
  it("listMessages returns every message oldest first, with the author of outbound ones", async () => {
    const id = await createViaForm({ customerEmail: "cust@example.com", subject: "Export failing", body: "First." });
    await reply(id, "Second.");
    await appendInbound(id, "Third.", new Date(Date.now() + 60_000));

    const { listMessages } = await import("@/lib/messages");
    const msgs = await listMessages(id);
    expect(msgs.map((m) => [m.direction, m.bodyText, m.author?.name ?? null])).toEqual([
      ["inbound", "First.", null],
      ["outbound", "Second.", "Alice Agent"],
      ["inbound", "Third.", null],
    ]);
  });

  it("triage reads the latest inbound message", async () => {
    const id = await createViaForm({ customerEmail: "cust@example.com", subject: "Charged twice", body: "Old question." });
    await appendInbound(id, "Newest question about refunds.", new Date(Date.now() + 60_000));
    provider.mockResolvedValue({
      rawText: JSON.stringify({ category: "billing", urgency: "low", draft: "Refunded.", article_id: null }),
      model: "fake-model",
    });

    const res = await triageViaApi(id, alice);

    expect(res.status).toBe(202);
    expect(provider.mock.calls[0][0].body).toBe("Newest question about refunds.");
  });
});

describe("search covers every message", () => {
  it("finds a ticket by text in a later message or a reply, and pages through matches", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createViaForm({ customerEmail: `c${i}@example.com`, subject: `Ticket ${i}`, body: "Opening message." }));
    }
    await appendInbound(ids[0], "Also the zebra report is blank.", new Date(Date.now() + 60_000));
    await reply(ids[1], "The zebra report is fixed.");
    await appendInbound(ids[2], "Zebra again.", new Date(Date.now() + 60_000));

    expect((await search("ZEBRA")).tickets.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect((await search("opening")).tickets).toHaveLength(3);

    const page1 = await search("zebra", "&limit=2");
    expect(page1.tickets).toHaveLength(2);
    const page2 = await search("zebra", `&limit=2&cursor=${page1.nextCursor}`);
    expect([...page1.tickets, ...page2.tickets].map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(page2.nextCursor).toBeNull();
  });
});

describe("migration 0004 back-fill", () => {
  const base = new URL(process.env.DATABASE_URL!);
  const dbName = `${decodeURIComponent(base.pathname.slice(1))}_migr`;
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  const admin = new URL(base);
  admin.pathname = "/postgres";

  async function migrateTo(folder: string) {
    const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder: folder });
    } finally {
      await client.end();
    }
  }

  it("turns ticket bodies into inbound messages and replies into sent outbound messages", async () => {
    const a = postgres(admin.toString(), { max: 1, onnotice: () => {} });
    await a.unsafe(`drop database if exists "${dbName}"`);
    await a.unsafe(`create database "${dbName}"`);
    await a.end();

    // The migrations folder as it was before 0004.
    const old = await mkdtemp(join(tmpdir(), "sift-migr-"));
    try {
      await cp("drizzle", old, { recursive: true });
      const journalPath = join(old, "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 4);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrateTo(old);
    } finally {
      await rm(old, { recursive: true, force: true });
    }

    const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      const [u] = await db`insert into users (email, name, role, password_hash) values ('a@x', 'A', 'agent', 'h') returning id`;
      const t0 = new Date("2026-01-01T10:00:00.123Z");
      const [t1] = await db`insert into tickets (customer_email, subject, body, source, external_message_id, created_at, updated_at)
        values ('c1@example.com', 'Refund', 'Please refund.', 'webhook', '<m1@mail>', ${t0}, ${t0}) returning id`;
      const [t2] = await db`insert into tickets (customer_email, subject, body, source, created_at, updated_at)
        values ('c2@example.com', 'Hello', 'Hi there.', 'form', ${t0}, ${t0}) returning id`;
      const s1 = new Date("2026-01-01T11:00:00.456Z");
      const s2 = new Date("2026-01-01T12:00:00.789Z");
      await db`insert into replies (ticket_id, ai_draft, final_body, sent_by, sent_at, edited, idempotency_key) values
        (${t1.id}, 'Draft', 'Draft', ${u.id}, ${s1}, false, 'key-1'),
        (${t1.id}, null, 'Follow-up', ${u.id}, ${s2}, true, 'key-2')`;

      await migrateTo("drizzle");

      const msgs = await db`select * from messages order by ticket_id, occurred_at, id`;
      expect(msgs.map((m) => ({ ...m, occurred_at: m.occurred_at.toISOString() }))).toEqual([
        expect.objectContaining({ ticket_id: t1.id, direction: "inbound", author_id: null, from_address: "c1@example.com", subject: "Refund", body_text: "Please refund.", message_id: "<m1@mail>", occurred_at: t0.toISOString(), status: null }),
        expect.objectContaining({ ticket_id: t1.id, direction: "outbound", author_id: u.id, to_address: "c1@example.com", body_text: "Draft", occurred_at: s1.toISOString(), status: "sent", ai_draft: "Draft", edited: false, idempotency_key: "key-1" }),
        expect.objectContaining({ ticket_id: t1.id, direction: "outbound", body_text: "Follow-up", occurred_at: s2.toISOString(), status: "sent", ai_draft: null, edited: true, idempotency_key: "key-2" }),
        expect.objectContaining({ ticket_id: t2.id, direction: "inbound", body_text: "Hi there.", message_id: null }),
      ]);
      const tickets = await db`select id, last_inbound_at, last_outbound_at from tickets order by id`;
      expect(tickets.map((t) => [t.last_inbound_at.toISOString(), t.last_outbound_at?.toISOString() ?? null])).toEqual([
        [t0.toISOString(), s2.toISOString()],
        [t0.toISOString(), null],
      ]);
    } finally {
      await db.end();
      const a2 = postgres(admin.toString(), { max: 1, onnotice: () => {} });
      await a2.unsafe(`drop database if exists "${dbName}"`);
      await a2.end();
    }
  }, 60_000); // creating a scratch database on the shared server can be slow
});
