import postgres from "postgres";
import { runMigrations } from "../scripts/migrate.mjs";
import { testDatabaseUrl } from "./db-url";

/** Creates the test database if it does not exist, then applies all migrations. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`Test database name must be [A-Za-z0-9_]+, got "${dbName}"`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runMigrations(url.toString());
}
