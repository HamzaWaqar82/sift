import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordHeartbeat } from "@/lib/worker/heartbeat";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());
beforeEach(async () => {
  await sql`truncate worker_heartbeats`;
});

async function health() {
  const { GET } = await import("@/app/api/health/route");
  return GET();
}

describe("GET /api/health", () => {
  it("reports the app is up, the database is connected and the worker is beating", async () => {
    await recordHeartbeat();

    const res = await health();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up", worker: "up", mail: "fake" });
  });

  it("reports the worker down when it has never beaten or its last beat is stale", async () => {
    expect(await (await health()).json()).toEqual({ status: "ok", db: "up", worker: "down", mail: "fake" });

    await recordHeartbeat();
    await sql`update worker_heartbeats set beat_at = now() - interval '2 minutes'`;

    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up", worker: "down", mail: "fake" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const original = process.env.DATABASE_URL;
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
    try {
      const res = await health();

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "error", db: "down", worker: "unknown", mail: "unknown" });
    } finally {
      process.env.DATABASE_URL = original;
      vi.resetModules();
    }
  });
});
