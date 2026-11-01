import Link from "next/link";
import { listAudit } from "@/lib/admin/users";
import { parseIntId } from "@/lib/http";

export const metadata = { title: "Audit log" };

const PAGE = 50;

function detail(m: Record<string, unknown> | null): string {
  if (!m) return "";
  return Object.entries(m)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const before = parseIntId((await searchParams).before ?? "") ?? undefined;
  const entries = await listAudit({ limit: PAGE + 1, before });
  const shown = entries.slice(0, PAGE);
  const next = entries.length > PAGE ? shown[shown.length - 1].id : null;

  return (
    <section aria-labelledby="audit-h">
      <h2 id="audit-h" className="sr-only">
        Audit log
      </h2>
      <div className="coupon-quiet overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead className="bg-panel-2 font-display text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th scope="col" className="px-3 py-2">When</th>
              <th scope="col" className="px-3 py-2">Action</th>
              <th scope="col" className="px-3 py-2">By</th>
              <th scope="col" className="px-3 py-2">Target</th>
              <th scope="col" className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="border-t border-rule-soft align-top">
                <td className="num whitespace-nowrap px-3 py-2 text-ink-2">
                  <time dateTime={e.createdAt}>{e.createdAt.slice(0, 16).replace("T", " ")}</time>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2">{e.actor ?? <span className="text-ink-3">System</span>}</td>
                <td className="px-3 py-2">{e.target ?? ""}</td>
                <td className="px-3 py-2 text-xs text-ink-2">{detail(e.metadata)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next !== null && (
        <Link href={`/admin/audit?before=${next}`} className="btn btn-sm mt-3">
          Older entries
        </Link>
      )}
    </section>
  );
}
