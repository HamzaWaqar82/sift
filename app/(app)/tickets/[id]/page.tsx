import Link from "next/link";
import { notFound } from "next/navigation";
import { getTicket } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";
import { SourceLabel, StatusBadge, timeAgo } from "../../_components/ticket-bits";
import { CloseTicketButton } from "./close-button";
import { ReassignControl } from "./reassign-control";
import { TicketReplies } from "./replies";
import { TriagePanel } from "./triage-panel";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseTicketId((await params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) notFound();

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← All tickets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-slate-500">
            #{ticket.id} · <SourceLabel source={ticket.source} /> · received{" "}
            <time dateTime={ticket.createdAt.toISOString()} title={ticket.createdAt.toISOString()}>
              {timeAgo(ticket.createdAt)}
            </time>
          </p>
        </div>
        {ticket.status !== "closed" && <CloseTicketButton ticketId={ticket.id} />}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
          <dd className="mt-1">
            <StatusBadge status={ticket.status} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Assignee</dt>
          <dd className="mt-1 text-slate-800">{ticket.assignee?.name ?? <span className="text-slate-400">Unassigned</span>}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Customer</dt>
          <dd className="mt-1 truncate text-slate-800">
            {ticket.customerName ? `${ticket.customerName} <${ticket.customerEmail}>` : ticket.customerEmail}
          </dd>
        </div>
      </dl>
      <ReassignControl ticketId={ticket.id} assignee={ticket.assignee} />
      <TriagePanel ticketId={ticket.id} />

      <section aria-label="Conversation">
        <article className="rounded-lg border border-slate-200 bg-white p-5">
          <header className="mb-3 text-sm text-slate-500">
            <span className="font-medium text-slate-800">{ticket.customerName ?? ticket.customerEmail}</span> wrote:
          </header>
          <div className="whitespace-pre-wrap break-words text-slate-800">{ticket.body}</div>
        </article>
        <TicketReplies ticket={ticket} />
      </section>
    </div>
  );
}
