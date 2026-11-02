import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedSampleTickets } from "../scripts/seed.mjs";
import { openingText } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const samplesDir = new URL("../samples/", import.meta.url);

beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

describe("sample ticket seed", () => {
  it("seeds every sample email as an open webhook ticket, once, however often it runs", async () => {
    const samples = JSON.parse(await readFile(new URL("emails.json", samplesDir), "utf8"));

    await seedSampleTickets(process.env.DATABASE_URL!);
    await seedSampleTickets(process.env.DATABASE_URL!);

    const rows = await sql`select * from tickets order by created_at`;
    expect(rows).toHaveLength(samples.length);
    expect(samples.length).toBeGreaterThanOrEqual(12);
    const first = samples[0];
    const row = rows.find((r) => r.external_message_id === first.message_id)!;
    expect(row).toMatchObject({
      customer_email: first.from.email,
      customer_name: first.from.name,
      subject: first.subject,
      source: "webhook",
      assignee_id: null,
    });
    expect(await openingText(row.id)).toBe(first.body);
    // Seeded in the samples' order, aged relative to the seed run.
    expect(rows.map((r) => r.external_message_id)).toEqual(
      [...samples].sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at)).map((s) => s.message_id),
    );
  });

  it("never seeds sample tickets in production, but does in staging", async () => {
    expect(await seedSampleTickets(process.env.DATABASE_URL!, new Date(), { APP_ENV: "production" })).toBe(0);
    expect(await sql`select 1 from tickets`).toHaveLength(0);

    expect(await seedSampleTickets(process.env.DATABASE_URL!, new Date(), { APP_ENV: "staging" })).toBeGreaterThan(0);
  });

  it("spreads ticket ages so some are overdue and some are not", async () => {
    await seedSampleTickets(process.env.DATABASE_URL!);
    const { overdueCount } = await import("@/lib/tickets/overdue");
    const [{ n }] = await sql`select count(*)::int as n from tickets`;
    const [{ newest }] = await sql`select max(last_inbound_at) as newest from tickets`;

    const overdue = await overdueCount();
    expect(overdue).toBeGreaterThanOrEqual(3);
    expect(n - overdue).toBeGreaterThanOrEqual(3);
    expect(Date.now() - newest.getTime()).toBeLessThan(2 * 3_600_000);
  });

  it("does not seed the emails reserved for the live webhook demo", async () => {
    const liveFiles = (await readdir(new URL("live/", samplesDir))).filter((f) => f.endsWith(".json"));
    expect(liveFiles).toHaveLength(2);

    await seedSampleTickets(process.env.DATABASE_URL!);

    for (const f of liveFiles) {
      const email = JSON.parse(await readFile(new URL(`live/${f}`, samplesDir), "utf8"));
      const found = await sql`select 1 from tickets where external_message_id = ${email.message_id}`;
      expect(found, f).toHaveLength(0);
    }
  });
});
