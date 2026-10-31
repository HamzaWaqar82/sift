import Link from "next/link";
import { InvalidCursorError, listTickets, type TicketListItem } from "@/lib/tickets";
import { listQuerySchema, TICKET_STATUSES } from "@/lib/tickets/schema";
import { SourceLabel, StatusBadge, timeAgo, TriageMarker } from "./_components/ticket-labels";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = [{ value: undefined, label: "All" }, ...TICKET_STATUSES.map((s) => ({ value: s, label: s }))];

/** Ticket list. Filter and cursor live in the URL; filter links drop the cursor (back = browser history). */
export default async function TicketListPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const parsed = listQuerySchema.safeParse({
    status: typeof sp.status === "string" && sp.status ? sp.status : undefined,
    cursor: typeof sp.cursor === "string" && sp.cursor ? sp.cursor : undefined,
  });
  const query = parsed.success ? parsed.data : {};

  let page: { tickets: TicketListItem[]; nextCursor: string | null } | null = null;
  try {
    page = parsed.success ? await listTickets(query) : null;
  } catch (err) {
    if (!(err instanceof InvalidCursorError)) throw err;
  }

  const nextHref = page?.nextCursor
    ? `/?${new URLSearchParams({ ...(query.status ? { status: query.status } : {}), cursor: page.nextCursor })}`
    : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <Link
          href="/tickets/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New ticket
        </Link>
      </div>

      <nav className="mt-6 flex gap-1 border-b border-slate-200 text-sm" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const active = query.status === f.value;
          return (
            <Link
              key={f.label}
              href={f.value ? `/?status=${f.value}` : "/"}
              className={`-mb-px border-b-2 px-3 py-2 capitalize ${
                active ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {!page ? (
        <p className="mt-8 text-slate-600">
          That page link is not valid any more.{" "}
          <Link href="/" className="font-medium underline">
            Start from the first page
          </Link>
          .
        </p>
      ) : page.tickets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          {query.cursor
            ? "No more tickets."
            : query.status
              ? `No ${query.status} tickets.`
              : "No tickets yet. New emails and form submissions will appear here."}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {page.tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="max-w-xs px-4 py-3">
                    <Link href={`/tickets/${t.id}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {t.subject}
                    </Link>
                    <TriageMarker triage={t.triage} />
                  </td>
                  <td className="max-w-[12rem] truncate px-4 py-3 text-slate-700" title={t.customerEmail}>
                    {t.customerName ?? t.customerEmail}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {t.assignee?.name ?? <span className="text-slate-400">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">
                    <SourceLabel source={t.source} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500" title={t.createdAt.toISOString()}>
                    {timeAgo(t.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextHref && (
        <div className="mt-4 flex justify-end">
          <Link
            href={nextHref}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}
