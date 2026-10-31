import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

// A database failure with text that must never reach the client.
vi.mock("@/lib/tickets", async (orig) => ({
  ...(await orig<typeof import("@/lib/tickets")>()),
  listTickets: vi.fn(async () => {
    throw new Error('PostgresError: relation "tickets" does not exist at /srv/app/node_modules/postgres/src/connection.js:42:7');
  }),
}));

let agent: string;
beforeAll(async () => {
  await seedTestUsers();
  agent = await signInAs("alice@sift.local");
});
afterAll(() => vi.restoreAllMocks());

describe("catch-all error handling", () => {
  it("an unexpected failure is a generic 500, logged server-side, with no internals leaked", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(new Request("http://localhost/api/tickets", { headers: { cookie: agent } }));

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Something went wrong. Please try again.", code: "internal_error" });
    expect(text).not.toMatch(/Postgres|relation|node_modules|srv\/app/);
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0][1])).toContain("relation");
    log.mockRestore();
  });

  it("route() maps HttpError to its status and body", async () => {
    const { route, HttpError } = await import("@/lib/http");
    const res = await route(async () => {
      throw new HttpError(418, "teapot", "short_and_stout", { a: "b" });
    })(new Request("http://localhost/x"));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "teapot", code: "short_and_stout", fields: { a: "b" } });
  });
});
