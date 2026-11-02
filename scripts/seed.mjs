// Seeds the staff accounts (4 agents + 1 admin) and the sample tickets (samples/emails.json). There is no sign-up; this is the only way
// users are created besides invitations. Staff accounts are seeded only into an empty users table
// (the first deploy), and an existing account is never touched, so a deploy cannot undo a password
// reset, an email change, a rename or a role change.
// Run by the `migrate` Compose service after migrations, by `npm run db:seed`, and by tests.
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Each account has its own password, from its own environment variable (`passwordEnv`).
export const SEED_USERS = [
  { key: "admin", email: "admin@sift.local", name: "Morgan Admin", role: "admin", passwordEnv: "SEED_PASSWORD_ADMIN" },
  { key: "alice", email: "alice@sift.local", name: "Alice Agent", role: "agent", passwordEnv: "SEED_PASSWORD_ALICE" },
  { key: "ben", email: "ben@sift.local", name: "Ben Agent", role: "agent", passwordEnv: "SEED_PASSWORD_BEN" },
  { key: "chloe", email: "chloe@sift.local", name: "Chloe Agent", role: "agent", passwordEnv: "SEED_PASSWORD_CHLOE" },
  { key: "dev", email: "dev@sift.local", name: "Dev Agent", role: "agent", passwordEnv: "SEED_PASSWORD_DEV" },
];

const BCRYPT_COST = 10;

/** { admin, alice, ... } passwords read from each account's SEED_PASSWORD_<NAME> variable. */
export function passwordsFromEnv(env = process.env) {
  return Object.fromEntries(SEED_USERS.map((u) => [u.key, env[u.passwordEnv]]));
}

/**
 * Inserts any missing staff accounts (marked email-verified) and their Better Auth credential rows
 * in `account` (account_id = users.id::text, the bcrypt hash in `password`). `passwords` is keyed
 * by account key (admin, alice, ben, chloe, dev). Existing users and their passwords are left as
 * they are.
 */
export async function seedUsers(url, passwords) {
  const missing = SEED_USERS.filter((u) => !passwords[u.key]).map((u) => u.passwordEnv);
  if (missing.length) throw new Error(`Seed passwords not set: ${missing.join(", ")}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const u of SEED_USERS) {
      const hash = await bcrypt.hash(passwords[u.key], BCRYPT_COST);
      await sql.begin(async (tx) => {
        const [inserted] = await tx`
          insert into users (email, name, role, email_verified)
          values (${u.email}, ${u.name}, ${u.role}, true)
          on conflict (email) do nothing
          returning id`;
        if (!inserted) return;
        await tx`
          insert into account (account_id, provider_id, user_id, password)
          values (${String(inserted.id)}, 'credential', ${inserted.id}, ${hash})
          on conflict (provider_id, account_id) do nothing`;
      });
    }
  } finally {
    await sql.end();
  }
}

/**
 * Seeds the staff accounts only when there are no users at all. Once staff exist, a later deploy
 * must not recreate an account whose email was changed, so the seed does nothing.
 */
export async function seedStaffIfEmpty(url, passwords) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [{ count }] = await sql`select count(*)::int as count from users`;
    if (count > 0) return false;
  } finally {
    await sql.end();
  }
  await seedUsers(url, passwords);
  return true;
}

const SAMPLE_EMAILS = new URL("../samples/emails.json", import.meta.url);

/**
 * Seeds each sample email (webhook contract shape) as an open, unassigned webhook ticket.
 * Idempotent: keyed on the email's message_id, so re-running never duplicates or overwrites.
 * The emails in samples/live/ are deliberately NOT seeded; they are posted live in the demo.
 * Ages are relative to the seed run (newest an hour old, the samples' spacing compressed 4x,
 * oldest under 3 days), so a fresh install shows both waiting and overdue tickets.
 * Returns the number of tickets newly created.
 */
export async function seedSampleTickets(url, now = new Date()) {
  const emails = JSON.parse(await readFile(SAMPLE_EMAILS, "utf8"));
  const newest = Math.max(...emails.map((e) => Date.parse(e.received_at)));
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let created = 0;
  try {
    for (const sample of emails) {
      const receivedAt = new Date(now.getTime() - 3_600_000 - (newest - Date.parse(sample.received_at)) / 4).toISOString();
      const e = { ...sample, received_at: receivedAt };
      // The ticket and its first inbound message, as createTicket writes them.
      const rows = await sql`
        with t as (
          insert into tickets (customer_email, customer_name, subject, body, source, external_message_id, created_at, updated_at, last_inbound_at)
          values (${e.from.email.toLowerCase()}, ${e.from.name ?? null}, ${e.subject}, ${e.body}, 'webhook',
                  ${e.message_id}, ${e.received_at}, ${e.received_at}, ${e.received_at})
          on conflict (external_message_id) do nothing
          returning *
        )
        insert into messages (ticket_id, direction, from_address, subject, body_text, message_id, occurred_at)
        select id, 'inbound', customer_email, subject, body, external_message_id, created_at from t
        returning ticket_id`;
      created += rows.length;
    }
  } finally {
    await sql.end();
  }
  return created;
}

const HELP_ARTICLES = new URL("../samples/help-articles.json", import.meta.url);

/**
 * Upserts the help articles the AI may cite (samples/help-articles.json), keyed on their slug id.
 * Idempotent: re-running updates titles and bodies. Returns the number of articles.
 */
export async function seedHelpArticles(url) {
  const articles = JSON.parse(await readFile(HELP_ARTICLES, "utf8"));
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const a of articles) {
      await sql`
        insert into help_articles (id, title, body) values (${a.id}, ${a.title}, ${a.body})
        on conflict (id) do update set title = excluded.title, body = excluded.body`;
    }
  } finally {
    await sql.end();
  }
  return articles.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  seedStaffIfEmpty(url, passwordsFromEnv())
    .then((seeded) => console.log(seeded ? `seeded ${SEED_USERS.length} users` : "users exist; staff seed skipped"))
    .then(() => seedSampleTickets(url))
    .then((n) => console.log(`seeded ${n} new sample tickets`))
    .then(() => seedHelpArticles(url))
    .then((n) => console.log(`seeded ${n} help articles`))
    .catch((err) => {
      console.error("seed failed:", err.message);
      process.exit(1);
    });
}
