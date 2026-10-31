// Seeds the staff accounts (4 agents + 1 admin) and the sample tickets (samples/emails.json). There is no sign-up; this is the only way
// users are created. Idempotent: re-running updates names, roles and password hashes, so
// changing a SEED_PASSWORD_<NAME> value in the environment and re-running rotates that password.
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
 * Upserts the staff accounts. `passwords` is keyed by account key (admin, alice, ben, chloe,
 * dev). Existing users get their hash replaced, so a changed password takes effect on re-seed.
 */
export async function seedUsers(url, passwords) {
  const missing = SEED_USERS.filter((u) => !passwords[u.key]).map((u) => u.passwordEnv);
  if (missing.length) throw new Error(`Seed passwords not set: ${missing.join(", ")}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const u of SEED_USERS) {
      const hash = await bcrypt.hash(passwords[u.key], BCRYPT_COST);
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
  seedUsers(url, passwordsFromEnv())
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
