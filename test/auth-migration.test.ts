// The Better Auth migration on old-shape data: existing bcrypt hashes become credential accounts.
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.mjs";
import { testDatabaseUrl } from "./db-url";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const url = new URL(testDatabaseUrl());
const dbName = `${decodeURIComponent(url.pathname.slice(1))}_auth_migration`;
url.pathname = `/${dbName}`;
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

let oldShape: string;

/** A copy of the migrations folder that stops just before the Better Auth migration. */
async function migrationsBeforeBetterAuth(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sift-migrations-"));
  await cp(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const cut = journal.entries.findIndex((e: { tag: string }) => e.tag.endsWith("_better_auth"));
  expect(cut).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, cut);
  await writeFile(journalPath, JSON.stringify(journal));
  return dir;
}

async function recreateDb() {
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  oldShape = await migrationsBeforeBetterAuth();
  await recreateDb();
}, 60_000);

afterAll(async () => {
  await rm(oldShape, { recursive: true, force: true });
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`).finally(() => admin.end());
}, 60_000);

it("moves existing password hashes into credential accounts and marks users verified", async () => {
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: oldShape });
    const hash = await bcrypt.hash("old-password", 4);
    const [{ id }] = await sql`
      insert into users (email, name, role, password_hash)
      values ('old@sift.local', 'Old User', 'agent', ${hash}) returning id`;

    await runMigrations(url.toString());

    const [account] = await sql`select account_id, provider_id, user_id, password from account`;
    expect(account).toEqual({ account_id: String(id), provider_id: "credential", user_id: id, password: hash });
    expect(await bcrypt.compare("old-password", account.password)).toBe(true);
    const [user] = await sql`select * from users where id = ${id}`;
    expect(user).toMatchObject({ email_verified: true, availability: "available", deactivated_at: null });
    expect(user).not.toHaveProperty("password_hash");
  } finally {
    await sql.end();
  }
}, 60_000);
