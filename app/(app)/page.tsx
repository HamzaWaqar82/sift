import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { boardTickets, InvalidCursorError, listAssignableUsers, listTickets, ticketSummary } from "@/lib/tickets";
import { parseBoardQuery, parseListQuery, parseSummaryQuery } from "@/lib/tickets/query";
import { parseTicketId } from "@/lib/tickets/schema";
import { apiParams, flatParams, hrefWith, pageSizeOf, trailOf, viewOf, type RawParams } from "./_lib/params";
import { FilterRail } from "./_components/filter-rail";
import { InboxList } from "./_components/inbox-list";
import { TicketTable } from "./_components/ticket-table";
import { Board } from "./_components/board";
import { toCard } from "./_lib/cards";
import { Pager } from "./_components/pager";
import { EmptyState, ExpiredPage, InvalidQuery } from "./_components/empty-state";
import { BoardSkeleton, DetailSkeleton, ListSkeleton, TableSkeleton } from "./_components/skeletons";
import { TicketView } from "./tickets/[id]/ticket-view";

type SearchParams = Promise<RawParams>;

export const metadata = { title: "Tickets" };

/** Ticket views: inbox (split pane), table and board. All state lives in the URL. */
export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const p = flatParams(await searchParams);
  const view = viewOf(p);

  const summaryQuery = parseSummaryQuery(apiParams(p), user.id);
  const [summary, users] = await Promise.all([
    summaryQuery.ok ? ticketSummary(summaryQuery.data) : null,
    listAssignableUsers(),
  ]);

  const rail = <FilterRail params={p} counts={summary} users={users} meId={user.id} />;
  // Re-key on everything but the open ticket so a new filter/page shows skeletons, not stale rows.
  const { ticket: _open, ...listKey } = p;
  const key = JSON.stringify(listKey);

  if (!summary) {
    return (
      <Frame view={view}>
        {rail}
        <InvalidQuery fields={summaryQuery.ok ? {} : summaryQuery.fields} />
      </Frame>
    );
  }

  if (view === "board") {
    return (
      <Frame view={view}>
        {rail}
        <Suspense key={key} fallback={<BoardSkeleton />}>
          <BoardResults p={p} userId={user.id} />
        </Suspense>
      </Frame>
    );
  }

  if (view === "table") {
    return (
      <Frame view={view}>
        {rail}
        <Suspense key={key} fallback={<TableSkeleton rows={Math.min(pageSizeOf(p), 12)} />}>
          <ListResults p={p} userId={user.id} view="table" total={matchTotal(p, summary)} />
        </Suspense>
      </Frame>
    );
  }

  // Inbox: list on the left, the open coupon on the right. Narrow screens show one at a time.
  const openId = p.ticket ? parseTicketId(p.ticket) : null;
  return (
    <div className="grid flex-1 md:grid-cols-[minmax(22rem,28rem)_1fr] xl:grid-cols-[30rem_1fr]">
      <section
        aria-label="Ticket list"
        className={`${openId ? "hidden md:flex" : "flex"} min-w-0 flex-col border-rule-soft md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:overflow-y-auto md:border-r`}
      >
        <div className="px-3 pt-4 pb-2 lg:px-4">{rail}</div>
        <Suspense key={key} fallback={<ListSkeleton rows={8} />}>
          <ListResults p={p} userId={user.id} view="inbox" total={matchTotal(p, summary)} openId={openId} />
        </Suspense>
      </section>
      <section
        aria-label="Open ticket"
        className={`${openId ? "block" : "hidden md:block"} min-w-0 px-3 py-4 md:px-6 lg:px-8`}
      >
        {openId ? (
          <>
            <Link href={hrefWith(p, { ticket: null })} className="btn btn-sm btn-ghost -ml-2 mb-3 md:hidden">
              <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Back to list
            </Link>
            <Suspense key={openId} fallback={<DetailSkeleton />}>
              <TicketView id={openId} embedded />
            </Suspense>
          </>
        ) : (
          <Suspense key={key} fallback={<DetailSkeleton />}>
            <FirstTicket p={p} userId={user.id} />
          </Suspense>
        )}
      </section>
    </div>
  );
}

function Frame({ view, children }: { view: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-4 px-3 py-4 lg:px-6" data-view={view}>
      {children}
    </div>
  );
}

/** N in "Showing 1–20 of N": the summary count for the active status filter (or all). */
function matchTotal(p: Record<string, string>, summary: { total: number; byStatus: Record<string, number> }): number {
  if (!p.status) return summary.total;
  return p.status
    .split(",")
    .map((s) => summary.byStatus[s.trim()] ?? 0)
    .reduce((a, b) => a + b, 0);
}

async function loadPage(p: Record<string, string>, userId: number) {
  const parsed = parseListQuery(apiParams(p, { limit: String(pageSizeOf(p)), ...(p.cursor ? { cursor: p.cursor } : {}) }), userId);
  if (!parsed.ok) return { kind: "invalid" as const, fields: parsed.fields };
  try {
    return { kind: "ok" as const, page: await listTickets(parsed.data) };
  } catch (err) {
    if (err instanceof InvalidCursorError) return { kind: "expired" as const };
    throw err;
  }
}

async function ListResults({
  p,
  userId,
  view,
  total,
  openId = null,
}: {
  p: Record<string, string>;
  userId: number;
  view: "inbox" | "table";
  total: number;
  openId?: number | null;
}) {
  const result = await loadPage(p, userId);
  if (result.kind === "invalid") return <InvalidQuery fields={result.fields} />;
  if (result.kind === "expired") return <ExpiredPage href={hrefWith(p, { cursor: null, trail: null })} />;
  const { tickets, nextCursor } = result.page;
  if (tickets.length === 0) return <EmptyState params={p} paged={!!p.cursor} />;

  const pager = (
    <Pager params={p} count={tickets.length} total={total} nextCursor={nextCursor} pageIndex={trailOf(p).length} compact={view === "inbox"} />
  );
  if (view === "table") {
    return (
      <div className="space-y-3">
        <TicketTable tickets={tickets} params={p} />
        {pager}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <InboxList tickets={tickets} params={p} selectedId={openId ?? tickets[0].id} explicitId={openId} />
      <div className="mt-auto border-t border-rule-soft bg-ground px-3 py-3 lg:px-4 md:sticky md:bottom-0">{pager}</div>
    </div>
  );
}

/** Desktop inbox with nothing chosen yet: open the first ticket of the list. */
async function FirstTicket({ p, userId }: { p: Record<string, string>; userId: number }) {
  const result = await loadPage(p, userId);
  const first = result.kind === "ok" ? result.page.tickets[0] : undefined;
  if (!first) {
    return (
      <div className="coupon-quiet grid min-h-64 place-items-center p-8 text-center text-sm text-ink-2">
        Nothing to open. Pick a ticket from the list when one arrives.
      </div>
    );
  }
  return <TicketView id={first.id} embedded />;
}

async function BoardResults({ p, userId }: { p: Record<string, string>; userId: number }) {
  const parsed = parseBoardQuery(apiParams(p, { limit: "10" }), userId);
  if (!parsed.ok) return <InvalidQuery fields={parsed.fields} />;
  const { column: _c, cursor: _cur, ...opts } = parsed.data;
  const { columns } = await boardTickets(opts);
  const total = Object.values(columns).reduce((a, c) => a + (c?.count ?? 0), 0);
  if (total === 0) return <EmptyState params={p} paged={false} />;
  const serial = Object.fromEntries(
    Object.entries(columns).map(([s, c]) => [s, { count: c!.count, nextCursor: c!.nextCursor, tickets: c!.tickets.map(toCard) }]),
  );
  return <Board columns={serial} query={apiParams(p).toString()} params={p} />;
}
