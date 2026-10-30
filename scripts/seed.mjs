// Seeds the staff accounts (4 agents + 1 admin). There is no sign-up; this is the only way
// users are created. Idempotent: re-running updates names, roles and password hashes, so
// changing SEED_*_PASSWORD in the environment and re-running rotates the passwords.
// Run by the `migrate` Compose service after migrations, by `npm run db:seed`, and by tests.
import bcrypt from "bcryptjs";
import postgres from "postgres";
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
    .catch((err) => {
      console.error("seed failed:", err.message);
      process.exit(1);
    });
}
