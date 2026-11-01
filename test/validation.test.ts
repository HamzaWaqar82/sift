import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs, giveTicketTo } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;
let admin: string;

beforeAll(async () => {
  await seedTestUsers();
  agent = await signInAs("alice@sift.local");
  admin = await signInAs("admin@sift.local");
  process.env.WEBHOOK_SECRET = "test-hook-secret";
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

const json = { "content-type": "application/json" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every error body must be {error: string, code?: string, fields?: Record<string,string>} and nothing else. */
async function expectErrorShape(res: Response, status: number, code?: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(Object.keys(body).every((k) => ["error", "code", "fields"].includes(k))).toBe(true);
  expect(typeof body.error).toBe("string");
  expect(JSON.stringify(body)).not.toMatch(/\bat .*\(.*:\d+:\d+\)|node_modules|postgres|PostgresError|select .* from/i);
  if (code) expect(body.code).toBe(code);
  return body;
}

async function postTicket(raw: string | object, cookie = agent) {
  const { POST } = await import("@/app/api/tickets/route");
  return POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { ...json, cookie },
      body: typeof raw === "string" ? raw : JSON.stringify(raw),
    }),
  );
}
const goodTicket = { customerEmail: "a@example.com", subject: "Subject", body: "Body" };

async function readTicket(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  const res = await GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie: agent } }), ctx(String(id)));
  return (await res.json()).ticket;
}

describe("JSON body handling (every body-taking route)", () => {
  const routes: { name: string; call: (raw: string) => Promise<Response> }[] = [
    { name: "POST /api/tickets", call: (raw) => postTicket(raw) },
    {
      name: "POST /api/webhook",
      call: async (raw) => {
        const { POST } = await import("@/app/api/webhook/route");
        return POST(new Request("http://localhost/api/webhook", { method: "POST", headers: { "x-webhook-secret": "test-hook-secret" }, body: raw }));
      },
    },
    {
      name: "POST /api/auth/sign-in",
      call: async (raw) => {
        const { POST } = await import("@/app/api/auth/sign-in/route");
        return POST(new Request("http://localhost/api/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "10.77.0.1" }, body: raw }));
      },
    },
    {
      name: "POST replies",
      call: async (raw) => {
        const { POST } = await import("@/app/api/tickets/[id]/replies/route");
        return POST(new Request("http://localhost/x", { method: "POST", headers: { cookie: agent }, body: raw }), ctx("1"));
      },
    },
    {
      name: "POST assign",
      call: async (raw) => {
        const { POST } = await import("@/app/api/tickets/[id]/assign/route");
        return POST(new Request("http://localhost/x", { method: "POST", headers: { cookie: admin }, body: raw }), ctx("1"));
      },
    },
    {
      name: "POST triage",
      call: async (raw) => {
        const { POST } = await import("@/app/api/tickets/[id]/triage/route");
        return POST(new Request("http://localhost/x", { method: "POST", headers: { cookie: agent }, body: raw }), ctx("1"));
      },
    },
  ];

  for (const r of routes) {
    it(`${r.name}: invalid JSON is a 400 invalid_json`, async () => {
      await expectErrorShape(await r.call("{not json"), 400, "invalid_json");
    });
    it(`${r.name}: a JSON array / string / null is a 400, not a 500`, async () => {
      for (const raw of ["[]", '"x"', "null", "42"]) {
        const res = await r.call(raw);
        expect(res.status, `${r.name} ${raw}`).toBe(400);
        await expectErrorShape(res, 400);
      }
    });
    it(`${r.name}: an oversized body is a 413`, async () => {
      await expectErrorShape(await r.call(JSON.stringify({ body: "x".repeat(2 * 1024 * 1024) })), 413, "payload_too_large");
    });
  }
});

describe("new ticket form: validation and sanitisation", () => {
  it("rejects whitespace-only and missing fields with per-field messages", async () => {
    const body = await expectErrorShape(await postTicket({ customerEmail: "   ", subject: " \t\n ", body: "\n\n" }), 400, "validation_failed");
    expect(Object.keys(body.fields).sort()).toEqual(["body", "customerEmail", "subject"]);
    const empty = await expectErrorShape(await postTicket({}), 400, "validation_failed");
    expect(Object.keys(empty.fields).sort()).toEqual(["body", "customerEmail", "subject"]);
  });

  it("rejects unknown keys, wrong types and over-long fields", async () => {
    await expectErrorShape(await postTicket({ ...goodTicket, status: "closed" }), 400, "validation_failed");
    await expectErrorShape(await postTicket({ ...goodTicket, subject: 5 }), 400, "validation_failed");
    const long = await postTicket({ ...goodTicket, subject: "s".repeat(201), body: "b".repeat(20_001), customerName: "n".repeat(201) });
    const body = await expectErrorShape(long, 400, "validation_failed");
    expect(Object.keys(body.fields).sort()).toEqual(["body", "customerName", "subject"]);
    expect((await postTicket({ ...goodTicket, subject: "s".repeat(200), body: "b".repeat(20_000) })).status).toBe(201);
  });

  it("lower-cases and trims the email", async () => {
    const res = await postTicket({ ...goodTicket, customerEmail: "  Mixed.Case@Example.COM  " });
    expect((await res.json()).ticket.customerEmail).toBe("mixed.case@example.com");
    await expectErrorShape(await postTicket({ ...goodTicket, customerEmail: "not-an-email" }), 400, "validation_failed");
    await expectErrorShape(await postTicket({ ...goodTicket, customerEmail: `${"a".repeat(250)}@example.com` }), 400, "validation_failed");
  });

  it("strips NUL and control characters, keeps newlines and tabs, normalises to NFC", async () => {
    const res = await postTicket({
      customerEmail: "a@example.com",
      customerName: "Zo\u0000e\u0007 \u202Eevil",
      subject: "Hel\u0000lo\u0001 wor\u007Fld\ne\u0301",
      body: "line1\r\nline2\tTabbed\u0000\u001B[31m\rline3\u200Bx",
    });
    expect(res.status).toBe(201);
    const { ticket } = await res.json();
    expect(ticket.customerName).toBe("Zoe evil");
    expect(ticket.subject).toBe("Hello world \u00E9"); // newline in a subject becomes a space; e + combining acute -> \u00E9
    expect(ticket.body).toBe("line1\nline2\tTabbed[31m\nline3x");
    const [row] = await sql`select subject, body from tickets where id = ${ticket.id}`;
    expect(row.subject).toBe(ticket.subject);
    expect(row.body).not.toMatch(/\u0000/);
  });

  it("a string that is only control characters counts as empty", async () => {
    await expectErrorShape(await postTicket({ ...goodTicket, subject: "\u0000\u0001\u200B" }), 400, "validation_failed");
  });
});

describe("hostile text is stored and returned literally (plain text, never HTML)", () => {
  const hostile = [
    `<script>alert("xss")</script>`,
    `<img src=x onerror=alert(1)>`,
    `"><svg/onload=alert(1)>`,
    `'; DROP TABLE tickets; --`,
    `Robert'); DELETE FROM users;--`,
    `{{7*7}} \${7*7} %s %1$s`,
    `javascript:alert(1)`,
    `&lt;b&gt; &amp;`,
  ];

  for (const text of hostile) {
    it(`round-trips ${JSON.stringify(text).slice(0, 40)}`, async () => {
      const res = await postTicket({ customerEmail: "a@example.com", customerName: text, subject: text, body: text });
      expect(res.status).toBe(201);
      const { ticket } = await res.json();
      expect(ticket.subject).toBe(text);
      expect(ticket.body).toBe(text);
      await giveTicketTo(ticket.id);
      const fetched = await readTicket(ticket.id);
      expect(fetched.subject).toBe(text);
      expect(fetched.body).toBe(text);
      expect(fetched.customerName).toBe(text);
      // And a reply with the same text.
      const { POST } = await import("@/app/api/tickets/[id]/replies/route");
      const rep = await POST(
        new Request("http://localhost/x", { method: "POST", headers: { ...json, cookie: agent }, body: JSON.stringify({ body: text, idempotencyKey: `hostile-${Math.random()}` }) }),
        ctx(String(ticket.id)),
      );
      expect((await rep.json()).reply.finalBody).toBe(text);
    });
  }

  it("the tickets table still exists afterwards", async () => {
    await postTicket({ ...goodTicket, subject: "'; DROP TABLE tickets; --" });
    expect((await sql`select count(*)::int as n from tickets`)[0].n).toBe(1);
  });

  it("no source file renders HTML from data", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(name) && /dangerouslySetInnerHTML|innerHTML\s*=/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "lib"));
    expect(hits).toEqual([]);
  });
});

describe("webhook payload sanitisation", () => {
  async function hook(payload: unknown) {
    const { POST } = await import("@/app/api/webhook/route");
    return POST(new Request("http://localhost/api/webhook", { method: "POST", headers: { "x-webhook-secret": "test-hook-secret" }, body: JSON.stringify(payload) }));
  }
  const mail = { from: { email: "Cust@Example.com", name: "Cust" }, subject: "Hi", body: "Body", message_id: "<m1@example.com>" };

  it("lower-cases the sender, strips control chars, rejects whitespace-only and unknown keys", async () => {
    const res = await hook({ ...mail, subject: "A\u0000B", body: "x\u0007y\nz" });
    expect(res.status).toBe(201);
    const { ticket } = await res.json();
    expect(ticket).toMatchObject({ customerEmail: "cust@example.com", subject: "AB", body: "xy\nz" });
    await expectErrorShape(await hook({ ...mail, message_id: "<m2>", subject: "  " }), 400, "validation_failed");
    await expectErrorShape(await hook({ ...mail, message_id: "<m3>", extra: 1 }), 400, "validation_failed");
    await expectErrorShape(await hook({ ...mail, message_id: "<m4>", from: { email: "x@y.com", role: "admin" } }), 400, "validation_failed");
  });

  it("unauthorised stays 401 with the uniform body", async () => {
    const { POST } = await import("@/app/api/webhook/route");
    await expectErrorShape(await POST(new Request("http://localhost/api/webhook", { method: "POST", body: "{}" })), 401);
  });
});

describe("reply, assign and triage bodies", () => {
  let id: number;
  beforeEach(async () => {
    id = (await (await postTicket(goodTicket)).json()).ticket.id;
    await giveTicketTo(id);
  });
  const reply = async (body: unknown) => {
    const { POST } = await import("@/app/api/tickets/[id]/replies/route");
    return POST(new Request("http://localhost/x", { method: "POST", headers: { ...json, cookie: agent }, body: JSON.stringify(body) }), ctx(String(id)));
  };

  it("replies: rejects whitespace-only, short keys, unknown keys, overflow draft ids; strips controls", async () => {
    await expectErrorShape(await reply({ body: "  \n ", idempotencyKey: "key-12345678" }), 400, "validation_failed");
    await expectErrorShape(await reply({ body: "ok", idempotencyKey: "short" }), 400, "validation_failed");
    await expectErrorShape(await reply({ body: "ok", idempotencyKey: "key-12345678", sentBy: 1 }), 400, "validation_failed");
    await expectErrorShape(await reply({ body: "ok", idempotencyKey: "key-12345678", draftTriageId: 99999999999 }), 400, "validation_failed");
    await expectErrorShape(await reply({ body: "x".repeat(20_001), idempotencyKey: "key-12345678" }), 400, "validation_failed");
    const ok = await reply({ body: "He\u0000llo\r\nthere", idempotencyKey: "key-12345678" });
    expect(ok.status).toBe(201);
    expect((await ok.json()).reply.finalBody).toBe("Hello\nthere");
  });

  it("assign: validates assigneeId type, range and unknown keys", async () => {
    const assign = async (body: unknown) => {
      const { POST } = await import("@/app/api/tickets/[id]/assign/route");
      return POST(new Request("http://localhost/x", { method: "POST", headers: { ...json, cookie: admin }, body: JSON.stringify(body) }), ctx(String(id)));
    };
    for (const bad of [{}, { assigneeId: "1" }, { assigneeId: 0 }, { assigneeId: -3 }, { assigneeId: 1.5 }, { assigneeId: 99999999999 }, { assigneeId: null, extra: 1 }]) {
      await expectErrorShape(await assign(bad), 400, "validation_failed");
    }
    await expectErrorShape(await assign({ assigneeId: 424242 }), 400, "unknown_user");
    expect((await assign({ assigneeId: null })).status).toBe(200);
  });

  it("triage: only an empty body or {force: boolean} is accepted", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/triage/route");
    const post = (body: string) => POST(new Request("http://localhost/x", { method: "POST", headers: { cookie: agent }, body }), ctx(String(id)));
    await expectErrorShape(await post('{"force":"yes"}'), 400, "validation_failed");
    await expectErrorShape(await post('{"other":1}'), 400, "validation_failed");
  });

  it("sign-in: normalises the email and rejects junk without leaking details", async () => {
    const { POST } = await import("@/app/api/auth/sign-in/route");
    const signIn = (body: unknown, ip: string) =>
      POST(new Request("http://localhost/x", { method: "POST", headers: { ...json, "x-forwarded-for": ip }, body: JSON.stringify(body) }));
    const { TEST_PASSWORDS } = await import("./helpers");
    expect((await signIn({ email: "  ALICE@Sift.Local ", password: TEST_PASSWORDS.alice }, "10.88.0.1")).status).toBe(200);
    expect((await signIn({ email: "alice@sift.local\u0000", password: TEST_PASSWORDS.alice }, "10.88.0.2")).status).toBe(200);
    await expectErrorShape(await signIn({ email: 5, password: "x" }, "10.88.0.3"), 400, "validation_failed");
    await expectErrorShape(await signIn({ email: "a", password: "x".repeat(201) }, "10.88.0.4"), 400, "validation_failed");
    await expectErrorShape(await signIn({ email: "a", password: "x", admin: true }, "10.88.0.5"), 400, "validation_failed");
  });
});

describe("ticket id path params", () => {
  const badIds = ["abc", "0", "-1", "1.5", "1e3", "99999999999", "2147483648", "00000000000001", "1%20OR%201=1", "1;drop", "%00", " 1"];
  const idRoutes = [
    { name: "GET detail", mod: "@/app/api/tickets/[id]/route", method: "GET", cookie: () => agent },
    { name: "GET replies", mod: "@/app/api/tickets/[id]/replies/route", method: "GET", cookie: () => agent },
    { name: "GET triage", mod: "@/app/api/tickets/[id]/triage/route", method: "GET", cookie: () => agent },
    { name: "POST replies", mod: "@/app/api/tickets/[id]/replies/route", method: "POST", cookie: () => agent, body: { body: "x", idempotencyKey: "key-12345678" } },
    { name: "POST triage", mod: "@/app/api/tickets/[id]/triage/route", method: "POST", cookie: () => agent },
    { name: "POST assign", mod: "@/app/api/tickets/[id]/assign/route", method: "POST", cookie: () => admin, body: { assigneeId: null } },
    { name: "POST close", mod: "@/app/api/tickets/[id]/close/route", method: "POST", cookie: () => admin },
    { name: "POST reopen", mod: "@/app/api/tickets/[id]/reopen/route", method: "POST", cookie: () => admin },
  ] as const;

  for (const r of idRoutes) {
    it(`${r.name}: bad ids are 404 (never 500)`, async () => {
      const mod = await import(/* @vite-ignore */ r.mod);
      for (const bad of badIds) {
        const res = await mod[r.method](
          new Request("http://localhost/x", {
            method: r.method,
            headers: { ...json, cookie: r.cookie() },
            ...("body" in r ? { body: JSON.stringify(r.body) } : {}),
          }),
          ctx(bad),
        );
        await expectErrorShape(res, 404, "not_found");
      }
    });
  }
});
