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
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

let keyCounter = 0;
const newKey = () => `test-key-${Date.now()}-${++keyCounter}`;

async function newTicket() {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: "cust@example.com",
    subject: "Export failing",
    body: "My CSV export fails.",
    source: "form",
  });
  return ticket.id;
}

async function sendReply(
  ticketId: number | string,
  body: unknown,
  cookie: string | null = alice,
) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(ticketId) }) },
  );
}

async function thread(ticketId: number, cookie: string | null = alice) {
  const { GET } = await import("@/app/api/tickets/[id]/replies/route");
  return GET(
    new Request(`http://localhost/api/tickets/${ticketId}/replies`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id: String(ticketId) }) },
  );
}

async function ticketStatus(ticketId: number) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  const res = await GET(new Request(`http://localhost/api/tickets/${ticketId}`, { headers: { cookie: alice } }), {
    params: Promise.resolve({ id: String(ticketId) }),
  });
  return (await res.json()).ticket.status;
}

/** Stores a valid triage with `draft` (or a failed one for null) and returns its id. */
async function addTriage(ticketId: number, draft: string | null): Promise<number> {
  const [row] =
    draft === null
      ? await sql`insert into triage_results (ticket_id, error, raw_output, model)
                  values (${ticketId}, 'invalid shape', '{"oops":1}', 'test-model') returning id`
      : await sql`insert into triage_results (ticket_id, category, urgency, draft, model)
                  values (${ticketId}, 'technical', 'high', ${draft}, 'test-model') returning id`;
  return row.id;
}

describe("sending a reply", () => {
  it("records the sender and send time and shows it in the thread", async () => {
    const id = await newTicket();
    const before = Date.now();

    const res = await sendReply(id, { body: "Hi, we are looking into it.", idempotencyKey: newKey() });

    expect(res.status).toBe(201);
    const { reply } = await res.json();
    expect(reply.finalBody).toBe("Hi, we are looking into it.");
    expect(reply.sentBy).toMatchObject({ name: "Alice Agent", email: "alice@sift.local" });
    const sentAt = new Date(reply.sentAt).getTime();
    expect(sentAt).toBeGreaterThanOrEqual(before - 1000);
    expect(sentAt).toBeLessThanOrEqual(Date.now() + 1000);

    const listed = await (await thread(id)).json();
    expect(listed.replies).toHaveLength(1);
    expect(listed.replies[0]).toMatchObject({
      id: reply.id,
      finalBody: "Hi, we are looking into it.",
      sentBy: { email: "alice@sift.local" },
      sentAt: reply.sentAt,
    });
  });

  it("records the stored AI draft and marks an unchanged send as unedited", async () => {
    const id = await newTicket();
    const draftTriageId = await addTriage(id, "Sorry about the export. Please retry.");

    const res = await sendReply(id, {
      body: "Sorry about the export. Please retry.",
      idempotencyKey: newKey(),
      draftTriageId,
    });

    expect(res.status).toBe(201);
    const { reply } = await res.json();
    expect(reply).toMatchObject({ aiDraft: "Sorry about the export. Please retry.", edited: false });
  });

  it("marks a changed draft as edited and ignores any client-supplied draft", async () => {
    const id = await newTicket();
    const draftTriageId = await addTriage(id, "Sorry about the export. Please retry.");

    const forged = await sendReply(id, {
      body: "Sorry about the export. We fixed it.",
      aiDraft: "Sorry about the export. We fixed it.",
      edited: false,
      idempotencyKey: newKey(),
      draftTriageId,
    });
    expect(forged.status).toBe(400); // unknown keys are rejected outright

    const res = await sendReply(id, {
      body: "Sorry about the export. We fixed it.",
      idempotencyKey: newKey(),
      draftTriageId,
    });

    const { reply } = await res.json();
    expect(reply).toMatchObject({ aiDraft: "Sorry about the export. Please retry.", edited: true });
  });

  it("sets the ticket to replied", async () => {
    const id = await newTicket();
    expect(await ticketStatus(id)).toBe("open");

    await sendReply(id, { body: "Done.", idempotencyKey: newKey() });

    expect(await ticketStatus(id)).toBe("replied");
  });

  it("rejects an empty or whitespace-only reply and changes nothing", async () => {
    const id = await newTicket();

    for (const body of ["", "   \n  "]) {
      const res = await sendReply(id, { body, idempotencyKey: newKey() });
      expect(res.status).toBe(400);
      expect((await res.json()).fields.body).toBeTruthy();
    }

    expect((await (await thread(id)).json()).replies).toHaveLength(0);
    expect(await ticketStatus(id)).toBe("open");
  });

  it("records only one reply for a double submit with the same key", async () => {
    const id = await newTicket();
    const key = newKey();

    const [a, b] = await Promise.all([
      sendReply(id, { body: "Once only.", idempotencyKey: key }),
      sendReply(id, { body: "Once only.", idempotencyKey: key }),
    ]);
    const third = await sendReply(id, { body: "Once only.", idempotencyKey: key });

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(third.status).toBe(200);
    const ids = await Promise.all([a, b, third].map(async (r) => (await r.json()).reply.id));
    expect(new Set(ids).size).toBe(1);
    expect((await (await thread(id)).json()).replies).toHaveLength(1);
  });

  it("works with no triage or a failed triage, recording no AI draft", async () => {
    const plain = await newTicket();
    const failed = await newTicket();
    await addTriage(failed, null);

    for (const id of [plain, failed]) {
      const res = await sendReply(id, { body: "Written by hand.", idempotencyKey: newKey() });
      expect(res.status).toBe(201);
      expect((await res.json()).reply).toMatchObject({ aiDraft: null, edited: true });
    }
  });

  it("lets any agent reply to a ticket assigned to someone else", async () => {
    const id = await newTicket();
    await sql`update tickets set assignee_id = (select id from users where email = 'alice@sift.local') where id = ${id}`;

    const res = await sendReply(id, { body: "Covering for Alice.", idempotencyKey: newKey() }, ben);

    expect(res.status).toBe(201);
    expect((await res.json()).reply.sentBy.email).toBe("ben@sift.local");
  });

  it("returns 401 when not signed in and records nothing", async () => {
    const id = await newTicket();

    const res = await sendReply(id, { body: "Hello", idempotencyKey: newKey() }, null);

    expect(res.status).toBe(401);
    expect((await thread(id, null)).status).toBe(401);
    expect((await (await thread(id)).json()).replies).toHaveLength(0);
  });

  it("returns 404 for a ticket that does not exist", async () => {
    const res = await sendReply(9999, { body: "Hello", idempotencyKey: newKey() });
    expect(res.status).toBe(404);
  });
});
