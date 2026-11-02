// One-off: deletes the demo tickets seeded from samples/emails.json, so production never replies to
// their real-looking customer addresses. Only tickets whose external_message_id is one of the
// samples' message_ids are touched; real tickets never are. Idempotent: a second run removes 0.
// Messages, notes and triage go with the ticket (on delete cascade); queued jobs about
// those tickets or their messages hold ids only in their JSON payload, so they are deleted here.
// In production:  docker compose -f compose.prod.yaml run --rm migrate node scripts/clear-demo-data.mjs
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { sampleEmails } from "./seed.mjs";

/** Deletes the sample tickets and everything hanging off them. Returns how many tickets went. */
export async function clearDemoTickets(url) {
  const ids = (await sampleEmails()).map((e) => e.message_id);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const demo = tx`select id from tickets where external_message_id = any(${ids})`;
      await tx`
        delete from jobs
        where (payload->>'ticketId') in (select id::text from (${demo}) d)
           or (payload->>'messageId') in (select m.id::text from messages m where m.ticket_id in (${demo}))`;
      const deleted = await tx`delete from tickets where id in (${demo}) returning id`;
      return deleted.length;
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  clearDemoTickets(url)
    .then((n) => console.log(`removed ${n} demo tickets`))
    .catch((err) => {
      console.error("clear-demo-data failed:", err.message);
      process.exit(1);
    });
}
