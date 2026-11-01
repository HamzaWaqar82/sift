import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs, triageViaApi } from "./helpers";

vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const SECRET = "INTERNAL-ONLY: customer is a journalist, escalate quietly";
let alice: string;
let ben: string;
let ticketId: number;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  alice = await signInAs("alice@sift.local");
  ben = await signInAs("ben@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage, jobs`;
  provider.mockReset();
  const { createTicket } = await import("@/lib/tickets");
  ticketId = (
    await createTicket({ customerEmail: "c@example.com", subject: "Charged twice", body: "Please refund.", source: "form" })
  ).ticket.id;
});
afterAll(async () => {
  await sql.end();
});

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function addNote(id: number, body: unknown, cookie = alice) {
  const { POST } = await import("@/app/api/tickets/[id]/notes/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ body }),
    }),
    ctx(id),
  );
}
async function listNotes(id: number, cookie = alice) {
  const { GET } = await import("@/app/api/tickets/[id]/notes/route");
  return GET(new Request(`http://localhost/api/tickets/${id}/notes`, { headers: { cookie } }), ctx(id));
}

describe("internal notes", () => {
  it("any agent can add a note to any ticket and every agent sees it", async () => {
    expect((await addNote(ticketId, "Called the customer.", alice)).status).toBe(201);
    expect((await addNote(ticketId, "Refund approved.", ben)).status).toBe(201);

    const { notes } = await (await listNotes(ticketId, ben)).json();
    expect(notes.map((n: { body: string; author: { name: string } }) => n.body)).toEqual(["Called the customer.", "Refund approved."]);
    expect(notes[0].author.name).toBeTruthy();
  });

  it("requires sign-in and an existing ticket, and rejects empty notes", async () => {
    expect((await addNote(ticketId, "x", "")).status).toBe(401);
    expect((await addNote(9999, "x")).status).toBe(404);
    expect((await addNote(ticketId, "   ")).status).toBe(400);
  });

  it("does not change ownership, status, the overdue clock or the conversation", async () => {
    const before = (await sql`select status, assignee_id, updated_at, last_outbound_at from tickets where id = ${ticketId}`)[0];
    await addNote(ticketId, SECRET);
    const after = (await sql`select status, assignee_id, updated_at, last_outbound_at from tickets where id = ${ticketId}`)[0];
    expect(after).toEqual(before);

    const { listMessages, latestInboundMessage } = await import("@/lib/messages");
    expect(await listMessages(ticketId)).toHaveLength(1);
    expect(JSON.stringify(await listMessages(ticketId))).not.toContain(SECRET);
    expect((await latestInboundMessage(ticketId))?.bodyText).toBe("Please refund.");
    expect(await sql`select 1 from messages where body_text like '%INTERNAL-ONLY%'`).toHaveLength(0);
  });

  it("is excluded from the triage prompt", async () => {
    await addNote(ticketId, SECRET);
    provider.mockResolvedValue({
      rawText: JSON.stringify({ category: "billing", urgency: "low", draft: "Hello", article_id: "duplicate-charges-and-refunds" }),
      model: "fake-model",
    });
    await triageViaApi(ticketId, alice);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(provider.mock.calls[0][0])).not.toContain("journalist");
  });

  // No Mailer exists yet (ticket 12). Outbound mail is built from `messages`, which notes never
  // enter; the check above plus this one guard that boundary until the Mailer test can assert it.
  it("never lands in messages, the only source outbound mail is built from", async () => {
    await addNote(ticketId, SECRET);
    expect(await sql`select 1 from messages where direction = 'outbound'`).toHaveLength(0);
    expect(await sql`select 1 from internal_notes`).toHaveLength(1);
  });
});
