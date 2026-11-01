import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/lib/jobs";
import { CaptureMailer, devMailboxEnabled, FakeMailer, getMailer, setMailer } from "@/lib/mail";
import { getCapturedMail, listCapturedMail } from "@/lib/mail/mailbox";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let admin: string;
let agent: string;

beforeAll(async () => {
  await seedTestUsers();
  admin = await signInAs("admin@sift.local");
  agent = await signInAs("alice@sift.local");
});
afterAll(() => sql.end());
beforeEach(async () => {
  await sql`truncate dev_mailbox, jobs restart identity`;
});
afterEach(() => {
  setMailer(null);
  process.env.MAIL_TRANSPORT = "fake";
  delete process.env.APP_ENV;
});

describe("capture transport", () => {
  it("stores the fully rendered email: headers and body", async () => {
    const id = await new CaptureMailer().send({
      to: "customer@example.com",
      subject: "Re: My invoice",
      text: "Hello,\nyour refund is on its way.",
      html: "<p>Hello, your refund is on its way.</p>",
      messageId: "<out-1@sift.local>",
      inReplyTo: "<in-2@example.com>",
      references: ["<in-1@example.com>", "<in-2@example.com>"],
    });
    expect(id).toBe("<out-1@sift.local>");

    const [summary] = await listCapturedMail();
    expect(summary).toMatchObject({
      from: "Sift Support <support@sift.local>",
      to: "customer@example.com",
      subject: "Re: My invoice",
    });
    const mail = (await getCapturedMail(summary.id))!;
    const header = (name: string) => mail.headers.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
    expect(header("From")).toBe("Sift Support <support@sift.local>");
    expect(header("To")).toBe("customer@example.com");
    expect(header("Subject")).toBe("Re: My invoice");
    expect(header("Message-ID")).toBe("<out-1@sift.local>");
    expect(header("In-Reply-To")).toBe("<in-2@example.com>");
    expect(header("References")).toBe("<in-1@example.com> <in-2@example.com>");
    expect(mail.text).toBe("Hello,\nyour refund is on its way.");
    expect(mail.html).toBe("<p>Hello, your refund is on its way.</p>");
    expect(mail.raw).toContain("your refund is on its way.");
    expect(mail.raw).toMatch(/Content-Type: multipart\/alternative/);
  });

  it("generates a Message-ID when the caller gives none", async () => {
    const id = await new CaptureMailer().send({ to: "a@example.com", subject: "Hi", text: "x" });
    expect(id).toMatch(/^<[0-9a-f-]+@sift\.local>$/);
    const [row] = await sql`select message_id from dev_mailbox`;
    expect(row.message_id).toBe(id);
  });
});

describe("getMailer", () => {
  it("picks the adapter named by MAIL_TRANSPORT and rejects unknown ones", () => {
    process.env.MAIL_TRANSPORT = "capture";
    expect(getMailer()).toBeInstanceOf(CaptureMailer);
    process.env.MAIL_TRANSPORT = "fake";
    expect(getMailer()).toBeInstanceOf(FakeMailer);
    process.env.MAIL_TRANSPORT = "carrier-pigeon";
    expect(() => getMailer()).toThrow(/MAIL_TRANSPORT/);
  });

  it("returns the override while one is set", () => {
    const fake = new FakeMailer();
    setMailer(fake);
    expect(getMailer()).toBe(fake);
  });
});

describe("/dev/mailbox availability", () => {
  it("is available only while mail is captured outside production", () => {
    process.env.MAIL_TRANSPORT = "capture";
    expect(devMailboxEnabled()).toBe(true);
    process.env.APP_ENV = "staging";
    expect(devMailboxEnabled()).toBe(true);
    process.env.APP_ENV = "production";
    expect(devMailboxEnabled()).toBe(false);
    delete process.env.APP_ENV;
    process.env.MAIL_TRANSPORT = "fake";
    expect(devMailboxEnabled()).toBe(false);
  });
});

describe("POST /api/admin/test-email", () => {
  async function post(cookie: string, body?: unknown) {
    const { POST } = await import("@/app/api/admin/test-email/route");
    return POST(
      new Request("http://localhost/api/admin/test-email", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  it("is admin only", async () => {
    expect((await post("")).status).toBe(401);
    expect((await post(agent)).status).toBe(403);
    const [{ n }] = await sql`select count(*)::int as n from jobs`;
    expect(n).toBe(0);
  });

  it("queues a test email the worker sends to the admin", async () => {
    const fake = new FakeMailer();
    setMailer(fake);

    const res = await post(admin);
    expect(res.status).toBe(202);
    expect(fake.sent).toHaveLength(0);

    await runDueJobs();

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({
      to: ["admin@sift.local"],
      subject: "Sift test email",
      from: { name: "Sift Support", address: "support@sift.local" },
    });
    expect(fake.sent[0].text).toContain("Morgan Admin");
  });

  it("lands in the dev mailbox with the capture transport", async () => {
    process.env.MAIL_TRANSPORT = "capture";

    expect((await post(admin, { to: "Someone@Example.com" })).status).toBe(202);
    await runDueJobs();

    const [mail] = await listCapturedMail();
    expect(mail).toMatchObject({ to: "someone@example.com", subject: "Sift test email" });
  });

  it("rejects a bad address", async () => {
    const res = await post(admin, { to: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "validation_failed" });
  });

  it("retries when the transport fails", async () => {
    const fake = new FakeMailer();
    fake.failWith(new Error("SMTP down"));
    setMailer(fake);

    await post(admin);
    await runDueJobs();

    const [job] = await sql`select status, attempts, last_error from jobs`;
    expect(job).toEqual({ status: "queued", attempts: 1, last_error: "SMTP down" });
  });
});
