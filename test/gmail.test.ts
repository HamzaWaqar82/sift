import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertMailConfig, getMailer, GmailMailer, PermanentMailError, setMailer } from "@/lib/mail";
import { parseHeaders } from "@/lib/mail/headers";
import { mailHealth, resetMailHealth } from "@/lib/mail/health";

// A local SMTP server stands in for smtp.gmail.com. `reject` makes it refuse the next recipient.
type Received = { from: string; to: string[]; raw: string; user: string; pass: string };
const received: Received[] = [];
let reject: { code: number; message: string } | null = null;
let connections = 0;
let server: SMTPServer;
let port: number;

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const env = { ...process.env };

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: false,
    allowInsecureAuth: true,
    hideSTARTTLS: true,
    logger: false,
    closeTimeout: 100,
    onConnect(_session, callback) {
      connections++;
      callback();
    },
    onAuth(auth, session, callback) {
      if (auth.password !== "abcdefghijklmnop") return callback(new Error("535 5.7.8 Username and Password not accepted"));
      (session as unknown as { creds: string[] }).creds = [auth.username!, auth.password!];
      callback(null, { user: auth.username });
    },
    onRcptTo(address, _session, callback) {
      if (!reject) return callback();
      const error = Object.assign(new Error(reject.message), { responseCode: reject.code });
      callback(error);
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const [user, pass] = (session as unknown as { creds: string[] }).creds;
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString("utf8"),
          user,
          pass,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql.end();
});
beforeEach(async () => {
  received.length = 0;
  reject = null;
  resetMailHealth();
  await sql`truncate dev_mailbox restart identity`;
  Object.assign(process.env, {
    GMAIL_USER: "sift.support@gmail.com",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    GMAIL_SMTP_HOST: "127.0.0.1",
    GMAIL_SMTP_PORT: String(port),
  });
});
afterEach(() => {
  setMailer(null);
  process.env = { ...env };
});

const gmail = (pass = "abcdefghijklmnop") =>
  new GmailMailer({ host: "127.0.0.1", port, user: "sift.support@gmail.com", pass });
const header = (raw: string, name: string) => parseHeaders(raw).find(([n]) => n.toLowerCase() === name)?.[1];

describe("gmail transport", () => {
  it("logs in with the app password and sends with our From, Message-ID and threading headers", async () => {
    process.env.MAIL_TRANSPORT = "gmail";
    process.env.APP_ENV = "production";

    const id = await getMailer().send({
      to: "customer@example.com",
      subject: "Re: Export failing",
      text: "We fixed the export.",
      messageId: "<out-1@gmail.com>",
      inReplyTo: "<in-2@example.com>",
      references: ["<in-1@example.com>", "<in-2@example.com>"],
    });

    expect(id).toBe("<out-1@gmail.com>");
    expect(received).toHaveLength(1);
    const [mail] = received;
    expect(mail).toMatchObject({ user: "sift.support@gmail.com", pass: "abcdefghijklmnop" });
    expect(mail.to).toEqual(["customer@example.com"]);
    expect(header(mail.raw, "from")).toBe("Sift Support <sift.support@gmail.com>");
    expect(header(mail.raw, "message-id")).toBe("<out-1@gmail.com>");
    expect(header(mail.raw, "in-reply-to")).toBe("<in-2@example.com>");
    expect(header(mail.raw, "references")).toBe("<in-1@example.com> <in-2@example.com>");
    expect(header(mail.raw, "reply-to")).toBeUndefined();
    expect(mail.raw).toContain("We fixed the export.");
  });

  it("treats a refused recipient as permanent", async () => {
    reject = { code: 550, message: "5.1.1 The email account that you tried to reach does not exist" };
    const error = await gmail().send({ to: "nobody@example.com", subject: "Hi", text: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error.message).toMatch(/does not exist/);
  });

  it("treats temporary refusals, the daily sending limit and a bad login as retryable", async () => {
    reject = { code: 421, message: "4.7.0 Try again later" };
    const temporary = await gmail().send({ to: "a@example.com", subject: "Hi", text: "x" }).catch((e) => e);
    expect(temporary).toBeInstanceOf(Error);
    expect(temporary).not.toBeInstanceOf(PermanentMailError);

    reject = { code: 550, message: "5.4.5 Daily user sending limit exceeded" };
    const quota = await gmail().send({ to: "a@example.com", subject: "Hi", text: "x" }).catch((e) => e);
    expect(quota).not.toBeInstanceOf(PermanentMailError);
    expect(quota.message).toMatch(/daily sending limit/i);

    reject = null;
    const login = await gmail("wrong").send({ to: "a@example.com", subject: "Hi", text: "x" }).catch((e) => e);
    expect(login).not.toBeInstanceOf(PermanentMailError);
    expect(login.message).toMatch(/refused the login.*app password/i);
    expect(received).toHaveLength(0);
  });
});

describe("staging allowlist", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      MAIL_TRANSPORT: "gmail",
      APP_ENV: "staging",
      MAIL_ALLOWED_RECIPIENTS: "owner@example.com, Tester@Example.com",
    });
  });

  it("really sends only to allowlisted addresses, with Reply-To on the +staging alias", async () => {
    await getMailer().send({ to: "tester@example.com", subject: "Re: Hi", text: "x" });

    expect(received).toHaveLength(1);
    expect(received[0].to).toEqual(["tester@example.com"]);
    expect(header(received[0].raw, "reply-to")).toBe("sift.support+staging@gmail.com");
    expect(await sql`select * from dev_mailbox`).toHaveLength(0);
  });

  it("captures mail to anyone else instead of sending it", async () => {
    await getMailer().send({ to: "customer@example.com", subject: "Re: Hi", text: "x" });
    await getMailer().send({ to: ["owner@example.com", "customer@example.com"], subject: "Re: Hi", text: "y" });

    expect(received).toHaveLength(0);
    const captured = await sql`select "to", raw from dev_mailbox order by id`;
    expect(captured).toHaveLength(2);
    expect(header(captured[0].raw, "reply-to")).toBe("sift.support+staging@gmail.com");
  });

  it("captures everything when the allowlist is empty", async () => {
    delete process.env.MAIL_ALLOWED_RECIPIENTS;
    await getMailer().send({ to: "owner@example.com", subject: "Hi", text: "x" });
    expect(received).toHaveLength(0);
    expect(await sql`select * from dev_mailbox`).toHaveLength(1);
  });
});

describe("startup guard", () => {
  it("refuses production without the gmail transport", () => {
    process.env.APP_ENV = "production";
    process.env.MAIL_TRANSPORT = "capture";
    expect(() => assertMailConfig()).toThrow(/MAIL_TRANSPORT=gmail/);
    process.env.MAIL_TRANSPORT = "gmail";
    expect(() => assertMailConfig()).not.toThrow();
  });

  it("refuses the gmail transport without credentials, in any environment", () => {
    process.env.MAIL_TRANSPORT = "gmail";
    delete process.env.GMAIL_APP_PASSWORD;
    expect(() => assertMailConfig()).toThrow(/GMAIL_USER and GMAIL_APP_PASSWORD/);
    expect(() => getMailer()).toThrow(/GMAIL_APP_PASSWORD/);
    process.env.APP_ENV = "production";
    expect(() => assertMailConfig()).toThrow(/GMAIL_APP_PASSWORD/);
  });

  it("lets development and staging capture mail", () => {
    process.env.MAIL_TRANSPORT = "capture";
    process.env.APP_ENV = "staging";
    expect(() => assertMailConfig()).not.toThrow();
  });
});

describe("health", () => {
  async function health() {
    const { GET } = await import("@/app/api/health/route");
    return (await GET()).json();
  }

  it("reports whether Gmail accepts our login, without making the check fail", async () => {
    process.env.MAIL_TRANSPORT = "gmail";
    expect(await health()).toMatchObject({ status: "ok", mail: "up" });

    resetMailHealth();
    process.env.GMAIL_APP_PASSWORD = "wrong";
    expect(await health()).toMatchObject({ status: "ok", mail: "down" });
  });

  it("probes Gmail at most once per 5 minutes", async () => {
    process.env.MAIL_TRANSPORT = "gmail";
    const before = connections;
    const t = Date.now();
    expect(await mailHealth(t)).toBe("up");
    expect(await mailHealth(t + 60_000)).toBe("up");
    expect(connections - before).toBe(1);
    expect(await mailHealth(t + 6 * 60_000)).toBe("up");
    expect(connections - before).toBe(2);
  });

  it("names the transport when mail is not delivered for real", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    expect(await health()).toMatchObject({ mail: "capture" });
  });
});
