import { describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
  it("reports the app is up and the database is connected", async () => {
    const { GET } = await import("@/app/api/health/route");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const original = process.env.DATABASE_URL;
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
    try {
      const { GET } = await import("@/app/api/health/route");

      const res = await GET();

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "error", db: "down" });
    } finally {
      process.env.DATABASE_URL = original;
      vi.resetModules();
    }
  });
});
