import { currentDraft, listReplies } from "@/lib/replies";
import type { TicketDetail } from "@/lib/tickets";
import { timeAgo } from "../../_components/ticket-bits";
import { WithArticlePanel } from "./article-panel";
import { ReplyEditor } from "./reply-editor";

/** Sent replies (thread) and the reply editor for one ticket. */
export async function TicketReplies({ ticket }: { ticket: TicketDetail }) {
  const replies = await listReplies(ticket.id);
  return (
    <div className="mt-4 space-y-4">
      {replies.map((r) => (
        <article key={r.id} className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <header className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              <span className="font-medium text-slate-800">{r.sentBy.name}</span> replied
            </span>
            <time dateTime={r.sentAt.toISOString()} title={r.sentAt.toISOString()}>
              {timeAgo(r.sentAt)}
            </time>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${r.edited ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
            >
              {r.edited ? "edited" : "unedited"}
              {r.aiDraft === null && " (no AI draft)"}
            </span>
          </header>
          <div className="whitespace-pre-wrap break-words text-slate-800">{r.finalBody}</div>
        </article>
      ))}
      <WithArticlePanel grounding={ticket.grounding}><ReplyEditor ticketId={ticket.id} draft={currentDraft(ticket)} /></WithArticlePanel>
    </div>
  );
}
