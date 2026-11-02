import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestInboundEmail } from "@/lib/inbound";
import { listMessages } from "@/lib/messages";
import { getTriageState } from "@/lib/triage/state";
import { giveTicketTo, seedTestUsers, skipAutoTriage } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const eml = (name: string) => readFileSync(`test/fixtures/inbound/${name}.eml`, "utf8");

beforeAll(async () => {
  await seedTestUsers();
});
beforeEach(async () => {
  await sql`truncate tickets, inbound_bounces, suppressed_emails restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

/** Dana's ticket from new.eml, answered by us with a sent reply whose Message-ID is `replyId`. */
async function answeredTicket(replyId = "<out-1@sift.test>", to = "dana@example.com") {
  const result = await ingestInboundEmail(eml("new"));
  if (result.kind !== "ticket") throw new Error("expected a ticket");
  const id = result.ticketId;
  await skipAutoTriage(id);
  const [msg] = await sql`
    insert into messages (ticket_id, direction, author_id, from_address, to_address, subject, body_text, message_id, status, attempts, occurred_at)
    values (${id}, 'outbound', (select id from users where email = 'alice@sift.local'), 'support@sift.test', ${to},
      'Re: Export keeps failing', 'Try again now.', ${replyId}, 'sent', 1, now() - interval '1 hour')
    returning id`;
  await sql`update messages set occurred_at = now() - interval '2 hours' where ticket_id = ${id} and direction = 'inbound'`;
  await sql`update tickets set status = 'replied', last_inbound_at = now() - interval '2 hours',
    last_outbound_at = now() - interval '1 hour' where id = ${id}`;
  await sql`insert into triage_results (ticket_id, category, urgency, draft, model, created_at)
    values (${id}, 'technical', 'high', 'Draft reply', 'test-model', now() - interval '1 hour')`;
  await giveTicketTo(id, "ben@sift.local");
  return { ticketId: id, replyRowId: msg.id as number };
}

async function ticketRow(id: number) {
  const [row] = await sql`select * from tickets where id = ${id}`;
  return row;
}

describe("ingestInboundEmail", () => {
  it("a new email becomes a new email ticket with its first message", async () => {
    const result = await ingestInboundEmail(eml("new"));
    expect(result.kind).toBe("ticket");
    if (result.kind !== "ticket") return;

    const ticket = await ticketRow(result.ticketId);
    expect(ticket).toMatchObject({
      customer_email: "dana@example.com",
      customer_name: "Dana Reyes",
      subject: "Export keeps failing",
      source: "email",
      status: "open",
    });
    const [message] = await listMessages(result.ticketId);
    expect(message).toMatchObject({ direction: "inbound", fromAddress: "dana@example.com", toAddress: "support@sift.test" });
    expect(message.bodyText).toContain("the CSV export fails every time");
  });

  it("the same Message-ID twice is stored once", async () => {
    const first = await ingestInboundEmail(eml("new"));
    const again = await ingestInboundEmail(eml("new"));
    expect(again).toEqual({ kind: "duplicate", ticketId: first.kind === "ticket" ? first.ticketId : -1 });
    expect((await sql`select count(*)::int as n from messages`)[0].n).toBe(1);
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(1);
  });

  it("an email without a Message-ID is still deduped on redelivery", async () => {
    const raw = eml("new").replace(/^Message-ID:.*\r\n/m, "");
    expect((await ingestInboundEmail(raw)).kind).toBe("ticket");
    expect((await ingestInboundEmail(raw)).kind).toBe("duplicate");
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(1);
  });

  it("a reply quoting our outbound Message-ID threads into the ticket, reopens it and keeps the owner", async () => {
    const { ticketId } = await answeredTicket();
    expect(await getTriageState(ticketId)).toMatchObject({ state: "done" });

    expect(await ingestInboundEmail(eml("reply-with-headers"))).toEqual({ kind: "appended", ticketId, reopened: true });

    const ticket = await ticketRow(ticketId);
    expect(ticket.status).toBe("open");
    expect(ticket.assignee_id).toBe((await sql`select id from users where email = 'ben@sift.local'`)[0].id);
    expect(ticket.last_inbound_at.getTime()).toBeGreaterThan(ticket.last_outbound_at.getTime());
    expect(await getTriageState(ticketId)).toMatchObject({ state: "superseded" });
    const thread = await listMessages(ticketId);
    expect(thread.map((m) => m.direction)).toEqual(["inbound", "outbound", "inbound"]);
    expect(thread[2].bodyText).toContain("Still failing after your fix");
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(1);
  });

  it("any id in References is enough, even when In-Reply-To is unknown", async () => {
    const created = await ingestInboundEmail(eml("new"));
    const result = await ingestInboundEmail(eml("reply-with-headers"));
    expect(result).toMatchObject({ kind: "appended", ticketId: created.kind === "ticket" ? created.ticketId : -1 });
  });

  it("a customer reply to a pooled ticket routes it to an available agent", async () => {
    const { ticketId } = await answeredTicket();
    await sql`update tickets set assignee_id = null, assigned_by = null where id = ${ticketId}`;
    await sql`update users set availability = 'available' where email = 'chloe@sift.local'`;
    try {
      await ingestInboundEmail(eml("reply-with-headers"));
    } finally {
      await sql`update users set availability = 'away'`;
    }
    const ticket = await ticketRow(ticketId);
    expect(ticket.assignee_id).toBe((await sql`select id from users where email = 'chloe@sift.local'`)[0].id);
    expect(ticket.assigned_by).toBe("auto");
  });

  it("a closed ticket reopens when the customer writes again", async () => {
    const { ticketId } = await answeredTicket();
    await sql`update tickets set status = 'closed' where id = ${ticketId}`;
    await ingestInboundEmail(eml("reply-with-headers"));
    expect((await ticketRow(ticketId)).status).toBe("open");
  });

  it("a reply without threading headers matches on normalised subject and the same sender", async () => {
    const { ticketId } = await answeredTicket();
    expect(await ingestInboundEmail(eml("reply-without-headers"))).toEqual({ kind: "appended", ticketId, reopened: true });
  });

  it("the subject fallback ignores a different sender and tickets older than 30 days", async () => {
    const { ticketId } = await answeredTicket();
    const stranger = eml("reply-without-headers")
      .replace("From: DANA@Example.com", "From: someone@else.com")
      .replace("<reply-2@example.com>", "<stranger-1@else.com>");
    expect((await ingestInboundEmail(stranger)).kind).toBe("ticket");

    await sql`update tickets set created_at = now() - interval '31 days', last_inbound_at = now() - interval '31 days',
      last_outbound_at = now() - interval '31 days' where id = ${ticketId}`;
    expect((await ingestInboundEmail(eml("reply-without-headers"))).kind).toBe("ticket");
  });

  it("a fresh email (no Re:) with an old ticket's subject is a new ticket, not merged into it", async () => {
    const { ticketId } = await answeredTicket();
    const fresh = eml("reply-without-headers")
      .replace("Subject: RE: Fwd:  Export keeps   failing", "Subject: Export keeps failing")
      .replace("<reply-2@example.com>", "<fresh-1@example.com>");
    const result = await ingestInboundEmail(fresh);
    expect(result.kind).toBe("ticket");
    expect(result).not.toMatchObject({ ticketId });
  });

  it("an attachment is noted on the message, not imported", async () => {
    const result = await ingestInboundEmail(eml("attachment"));
    if (result.kind !== "ticket") throw new Error("expected a ticket");
    const [message] = await listMessages(result.ticketId);
    expect(message.bodyText).toContain("My invoice is attached");
    expect(message.bodyText).toContain("[Attachment not imported: invoice-2026-10.pdf]");
  });

  it("a mailer-daemon bounce marks the reply bounced, suppresses the address and creates no ticket", async () => {
    const { ticketId, replyRowId } = await answeredTicket("<out-bounce@sift.test>", "gone@example.com");

    expect(await ingestInboundEmail(eml("bounce"))).toEqual({ kind: "bounce", outboundMessageId: replyRowId });

    const reply = (await listMessages(ticketId)).find((m) => m.id === replyRowId)!;
    expect(reply.status).toBe("bounced");
    expect(reply.lastError).toContain("550 5.1.1");
    expect((await sql`select reason from suppressed_emails where email = 'gone@example.com'`)[0].reason).toMatch(/^bounced/);
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(1);
    const ticket = await ticketRow(ticketId);
    expect(ticket.status).toBe("open");
    expect(ticket.last_outbound_at).toBeNull();

    expect((await ingestInboundEmail(eml("bounce"))).kind).toBe("duplicate");
  });

  it("an unmatched bounce is recorded, never a ticket", async () => {
    expect(await ingestInboundEmail(eml("bounce"))).toEqual({ kind: "bounce", outboundMessageId: null });
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(0);
    expect((await sql`select recipient from inbound_bounces`)[0].recipient).toBe("gone@example.com");
  });
});
