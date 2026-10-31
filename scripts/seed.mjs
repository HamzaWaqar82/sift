// Seeds the staff accounts (4 agents + 1 admin) and the sample tickets (samples/emails.json). There is no sign-up; this is the only way
// users are created. Idempotent: re-running updates names, roles and password hashes, so
// changing SEED_*_PASSWORD in the environment and re-running rotates the passwords.
// Run by the `migrate` Compose service after migrations, by `npm run db:seed`, and by tests.
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SEED_USERS = [
  { email: "admin@sift.local", name: "Morgan Admin", role: "admin" },
  { email: "alice@sift.local", name: "Alice Agent", role: "agent" },
  { email: "ben@sift.local", name: "Ben Agent", role: "agent" },
  { email: "chloe@sift.local", name: "Chloe Agent", role: "agent" },
  { email: "dev@sift.local", name: "Dev Agent", role: "agent" },
];

const BCRYPT_COST = 10;

export async function seedUsers(url, { adminPassword, agentPassword }) {
  if (!adminPassword || !agentPassword) {
    throw new Error("SEED_ADMIN_PASSWORD and SEED_AGENT_PASSWORD must both be set");
  }
  const adminHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
  const agentHash = await bcrypt.hash(agentPassword, BCRYPT_COST);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const u of SEED_USERS) {
      const hash = u.role === "admin" ? adminHash : agentHash;
      await sql`
        insert into users (email, name, role, password_hash)
        values (${u.email}, ${u.name}, ${u.role}, ${hash})
        on conflict (email) do update
          set name = excluded.name, role = excluded.role, password_hash = excluded.password_hash`;
    }
  } finally {
    await sql.end();
  }
}

const SAMPLE_EMAILS = new URL("../samples/emails.json", import.meta.url);

/**
 * Seeds each sample email (webhook contract shape) as an open, unassigned webhook ticket.
 * Idempotent: keyed on the email's message_id, so re-running never duplicates or overwrites.
 * The emails in samples/live/ are deliberately NOT seeded; they are posted live in the demo.
 * Returns the number of tickets newly created.
 */
export async function seedSampleTickets(url) {
  const emails = JSON.parse(await readFile(SAMPLE_EMAILS, "utf8"));
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let created = 0;
  try {
    for (const e of emails) {
      const rows = await sql`
        insert into tickets (customer_email, customer_name, subject, body, source, external_message_id, created_at, updated_at)
        values (${e.from.email.toLowerCase()}, ${e.from.name ?? null}, ${e.subject}, ${e.body}, 'webhook',
                ${e.message_id}, ${e.received_at}, ${e.received_at})
        on conflict (external_message_id) do nothing
        returning id`;
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
  seedUsers(url, {
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    agentPassword: process.env.SEED_AGENT_PASSWORD,
  })
    .then(() => console.log(`seeded ${SEED_USERS.length} users`))
    .then(() => seedSampleTickets(url))
    .then((n) => console.log(`seeded ${n} new sample tickets`))
    .then(() => seedHelpArticles(url))
    .then((n) => console.log(`seeded ${n} help articles`))
    .catch((err) => {
      console.error("seed failed:", err.message);
      process.exit(1);
    });
}
