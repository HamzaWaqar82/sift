import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs } from "./helpers";

// The provider is the only fake. Real Gemini is never called.
vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  agent = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  provider.mockReset();
});
afterAll(async () => {
  await sql.end();
});

async function newTicket() {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: "maria@example.com",
    subject: "Charged twice",
    body: "I was charged twice this month, please refund one.",
    source: "form",
  });
  return ticket.id;
}

async function triageWith(id: number, output: unknown) {
  provider.mockResolvedValueOnce({
    rawText: typeof output === "string" ? output : JSON.stringify(output),
    model: "fake-model",
  });
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/triage`, { method: "POST", headers: { cookie: agent } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

async function readTicket(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  const res = await GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie: agent } }), {
    params: Promise.resolve({ id: String(id) }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).ticket;
}

const GROUNDED = {
  category: "billing",
  urgency: "medium",
  draft: "Hi Maria, sorry about the duplicate charge. We have refunded it.",
  article_id: "duplicate-charges-and-refunds",
};

describe("help article next to the reply (ticket detail API)", () => {
  it("returns the referenced article's title and full body", async () => {
    const id = await newTicket();
    expect((await triageWith(id, GROUNDED)).status).toBe(200);

    const ticket = await readTicket(id);

    const [seeded] = await sql`select title, body from help_articles where id = 'duplicate-charges-and-refunds'`;
    expect(ticket.grounding).toEqual({
      article: { id: "duplicate-charges-and-refunds", title: seeded.title, body: seeded.body },
    });
    expect(ticket.grounding.article.body.length).toBeGreaterThan(50);
  });

  it("marks a valid draft with no article as ungrounded", async () => {
    const id = await newTicket();
    expect((await triageWith(id, { ...GROUNDED, article_id: null })).status).toBe(200);

    const ticket = await readTicket(id);

    expect(ticket.grounding).toEqual({ article: null });
  });

  it("has no grounding when the ticket was never triaged", async () => {
    const id = await newTicket();
    expect((await readTicket(id)).grounding).toBeNull();
  });

  it("never exposes an invented article: an unknown id fails triage and gives no grounding", async () => {
    const id = await newTicket();
    expect((await triageWith(id, { ...GROUNDED, article_id: "made-up-article" })).status).toBe(502);

    expect((await readTicket(id)).grounding).toBeNull();
  });

  it("uses the latest valid triage, ignoring a later failed attempt", async () => {
    const id = await newTicket();
    expect((await triageWith(id, GROUNDED)).status).toBe(200);
    // A later failed attempt (e.g. a failed admin regenerate).
    await sql`insert into triage_results (ticket_id, error, raw_output, model, created_at)
      values (${id}, 'bad output', 'not json', 'fake-model', now() + interval '1 second')`;

    const ticket = await readTicket(id);

    expect(ticket.grounding.article.id).toBe("duplicate-charges-and-refunds");
  });
});
