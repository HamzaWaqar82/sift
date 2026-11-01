import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueJob, registerJobHandler, runDueJobs } from "@/lib/jobs";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

let ran: string[] = [];
let failuresLeft = 0;
let failedCalls: { payload: unknown; error: string }[] = [];

registerJobHandler<{ name: string }>("test.record", {
  async run({ name }) {
    ran.push(name);
  },
});
registerJobHandler<{ name: string }>("test.flaky", {
  async run({ name }) {
    ran.push(name);
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error(`boom ${name}`);
    }
  },
  async onFailed(payload, error) {
    failedCalls.push({ payload, error });
  },
});
registerJobHandler<{ name: string }>("test.always-fails-now", {
  backoffSeconds: [0],
  async run({ name }) {
    ran.push(name);
    throw new Error("still broken");
  },
});
registerJobHandler<{ name: string }>("test.slow", {
  async run({ name }) {
    await new Promise((r) => setTimeout(r, 30));
    ran.push(name);
  },
});

beforeEach(async () => {
  await sql`truncate jobs restart identity`;
  ran = [];
  failuresLeft = 0;
  failedCalls = [];
});

const job = async (id: number) => (await sql`select * from jobs where id = ${id}`)[0];
/** Moves a job's run_at into the past so it is due now (time is controlled through the DB). */
const makeDue = (id: number) => sql`update jobs set run_at = now() - interval '1 second' where id = ${id}`;

describe("runDueJobs", () => {
  it("runs due jobs by priority, then run_at, and leaves future jobs alone", async () => {
    const past = (s: number) => new Date(Date.now() - s * 1000);
    await enqueueJob("test.record", { name: "low-newer" }, { runAt: past(10) });
    await enqueueJob("test.record", { name: "low-older" }, { runAt: past(60) });
    await enqueueJob("test.record", { name: "high" }, { priority: 10, runAt: past(1) });
    const future = await enqueueJob("test.record", { name: "later" }, { runAt: new Date(Date.now() + 60_000) });

    const summary = await runDueJobs();

    expect(ran).toEqual(["high", "low-older", "low-newer"]);
    expect(summary).toMatchObject({ succeeded: 3, retried: 0, failed: 0 });
    expect((await job(future)).status).toBe("queued");
    const statuses = await sql`select status, count(*)::int as n from jobs group by status order by status`;
    expect(statuses).toEqual([
      { status: "queued", n: 1 },
      { status: "done", n: 3 },
    ]);
  });

  it("processes each due job at most once per call, even when its retry is due immediately", async () => {
    const id = await enqueueJob("test.always-fails-now", { name: "x" });

    const summary = await runDueJobs();

    expect(ran).toEqual(["x"]);
    expect(summary.retried).toBe(1);
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 1, last_error: "still broken" });
  });

  it("retries a failed job after the backoff and records the error meanwhile", async () => {
    failuresLeft = 1;
    const id = await enqueueJob("test.flaky", { name: "flaky" });

    await runDueJobs();
    const afterFailure = await job(id);
    expect(afterFailure).toMatchObject({ status: "queued", attempts: 1, last_error: "boom flaky", locked_at: null });
    const [{ wait }] = await sql`select extract(epoch from run_at - now())::float as wait from jobs where id = ${id}`;
    expect(wait).toBeGreaterThan(5);
    expect(wait).toBeLessThanOrEqual(10);

    await runDueJobs(); // not due yet
    expect(ran).toEqual(["flaky"]);

    await makeDue(id);
    await runDueJobs();
    expect(ran).toEqual(["flaky", "flaky"]);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 2, last_error: null });
  });

  it("marks an exhausted job failed with the last error", async () => {
    failuresLeft = 99;
    const id = await enqueueJob("test.flaky", { name: "doomed" }, { maxAttempts: 2 });

    await runDueJobs();
    await makeDue(id);
    const summary = await runDueJobs();

    expect(summary.failed).toBe(1);
    const row = await job(id);
    expect(row).toMatchObject({ status: "failed", attempts: 2, last_error: "boom doomed" });
    expect(row.finished_at).not.toBeNull();
    expect(failedCalls).toEqual([{ payload: { name: "doomed" }, error: "boom doomed" }]);

    await makeDue(id);
    await runDueJobs();
    expect(ran).toEqual(["doomed", "doomed"]);
  });

  it("fails a job of an unknown kind without retrying", async () => {
    const id = await enqueueJob("test.nobody-handles-this", {});

    await runDueJobs();

    expect(await job(id)).toMatchObject({ status: "failed", attempts: 1 });
    expect((await job(id)).last_error).toMatch(/No handler registered/);
  });

  it("recovers a stale lock: requeues and runs it, or fails it once attempts are used up", async () => {
    const stale = await enqueueJob("test.record", { name: "abandoned" });
    const spent = await enqueueJob("test.flaky", { name: "spent" }, { maxAttempts: 1 });
    const fresh = await enqueueJob("test.record", { name: "still-running" });
    await sql`update jobs set status = 'running', attempts = 1, locked_at = now() - interval '11 minutes' where id in ${sql([stale, spent])}`;
    await sql`update jobs set status = 'running', attempts = 1, locked_at = now() where id = ${fresh}`;

    const summary = await runDueJobs();

    expect(summary.recovered).toBe(2);
    expect(ran).toEqual(["abandoned"]);
    expect(await job(stale)).toMatchObject({ status: "done", attempts: 2 });
    expect(await job(spent)).toMatchObject({ status: "failed", attempts: 1 });
    expect((await job(spent)).last_error).toMatch(/Lock expired/);
    expect(failedCalls).toHaveLength(1);
    expect((await job(fresh)).status).toBe("running");
  });

  it("never runs a job twice when two runners claim at the same time", async () => {
    for (const name of ["a", "b", "c", "d", "e", "f"]) await enqueueJob("test.slow", { name });

    await Promise.all([runDueJobs(), runDueJobs()]);

    expect([...ran].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    const [{ n }] = await sql`select count(*)::int as n from jobs where status = 'done' and attempts = 1`;
    expect(n).toBe(6);
  });
});
