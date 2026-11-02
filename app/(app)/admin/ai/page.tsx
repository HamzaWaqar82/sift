import Link from "next/link";
import { aiPanel } from "@/lib/triage/limiter";

export const metadata = { title: "AI" };

function stamp(d: Date | null): string {
  return d ? d.toISOString().slice(0, 19).replace("T", " ") : "";
}

function ticketOf(payload: unknown): number | null {
  const id = (payload as { ticketId?: unknown } | null)?.ticketId;
  return typeof id === "number" ? id : null;
}

const HEAD = "bg-panel-2 font-display text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3";

/** Admin AI panel: today's budget, the AI queue, recent provider calls (with 429s) and failed jobs. */
export default async function AiPage() {
  const { budget, rpm, rateLimitedToday, queue, calls, failedJobs } = await aiPanel();
  const stats = [
    { label: "Calls today", value: `${budget.used}/${budget.cap}` },
    { label: "Per-minute limit", value: String(rpm) },
    { label: "Rate-limited today", value: String(rateLimitedToday) },
    { label: "Queued", value: String(queue.queued) },
    { label: "Running", value: String(queue.running) },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="ai-budget-h">
        <h2 id="ai-budget-h" className="sr-only">
          Budget and queue
        </h2>
        <dl className="coupon-quiet grid grid-cols-2 gap-px sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="px-3 py-2">
              <dt className="field-label">{s.label}</dt>
              <dd className="num text-lg text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
        {budget.pausedUntil && (
          <p className="mt-2 text-sm text-warn-ink">
            AI calls are paused until <span className="num">{stamp(budget.pausedUntil)} UTC</span>.
          </p>
        )}
      </section>

      <section aria-labelledby="ai-calls-h">
        <h2 id="ai-calls-h" className="caps text-sm text-ink">
          Recent calls
        </h2>
        <div className="coupon-quiet mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead className={HEAD}>
              <tr>
                <th scope="col" className="px-3 py-2">Started (UTC)</th>
                <th scope="col" className="px-3 py-2">Ticket</th>
                <th scope="col" className="px-3 py-2">Lane</th>
                <th scope="col" className="px-3 py-2">Outcome</th>
                <th scope="col" className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-t border-rule-soft align-top">
                  <td className="num whitespace-nowrap px-3 py-2 text-ink-2">{stamp(c.startedAt)}</td>
                  <td className="px-3 py-2">
                    {c.ticketId !== null ? (
                      <Link className="link num" href={`/tickets/${c.ticketId}`}>
                        #{c.ticketId}
                      </Link>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-2">{c.lane}</td>
                  <td className={`px-3 py-2 font-mono text-xs ${c.outcome === "ok" ? "" : "text-jet-ink"}`}>{c.outcome}</td>
                  <td className="max-w-md truncate px-3 py-2 text-xs text-ink-2" title={c.detail ?? undefined}>
                    {c.detail ?? ""}
                  </td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                    No AI calls yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ai-failed-h">
        <h2 id="ai-failed-h" className="caps text-sm text-ink">
          Failed jobs
        </h2>
        <div className="coupon-quiet mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead className={HEAD}>
              <tr>
                <th scope="col" className="px-3 py-2">Failed (UTC)</th>
                <th scope="col" className="px-3 py-2">Kind</th>
                <th scope="col" className="px-3 py-2">Ticket</th>
                <th scope="col" className="px-3 py-2">Tries</th>
                <th scope="col" className="px-3 py-2">Last error</th>
              </tr>
            </thead>
            <tbody>
              {failedJobs.map((j) => {
                const ticketId = ticketOf(j.payload);
                return (
                  <tr key={j.id} className="border-t border-rule-soft align-top">
                    <td className="num whitespace-nowrap px-3 py-2 text-ink-2">{stamp(j.finishedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{j.kind}</td>
                    <td className="px-3 py-2">
                      {ticketId !== null ? (
                        <Link className="link num" href={`/tickets/${ticketId}`}>
                          #{ticketId}
                        </Link>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="num px-3 py-2">{j.attempts}</td>
                    <td className="max-w-md truncate px-3 py-2 text-xs text-ink-2" title={j.lastError ?? undefined}>
                      {j.lastError ?? ""}
                    </td>
                  </tr>
                );
              })}
              {failedJobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                    No failed jobs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
