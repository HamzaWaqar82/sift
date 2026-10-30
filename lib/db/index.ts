import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb(url: string) {
  const client = postgres(url, { max: 10, connect_timeout: 5, onnotice: () => {} });
  return drizzle(client, { schema });
}

type Db = ReturnType<typeof createDb>;
let db: Db | undefined;

/** Lazily-created shared Drizzle client. Reads DATABASE_URL at first use. */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    db = createDb(url);
  }
  return db;
}
