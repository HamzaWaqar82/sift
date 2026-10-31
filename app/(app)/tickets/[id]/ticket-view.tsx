import { notFound } from "next/navigation";
import { getPageUser, isAdmin } from "@/lib/auth";
import { listReplies } from "@/lib/replies";
import { getTicket, listAssignableUsers } from "@/lib/tickets";
import { getLatestAttempt } from "@/lib/triage";
import { LABELS } from "../../_lib/params";
import { CategoryLabel, SourceLabel, TicketNo, UrgencyTab, stampTime, timeAgo } from "../../_components/ticket-labels";
import { WithArticlePanel } from "./article-panel";
import { TicketActions } from "./close-button";
import { ReassignForm } from "./reassign-form";
import { ReplyEditor } from "./reply-editor";
import { Thread } from "./replies";
import { TriagePanelClient, type TriageViewJson } from "./triage-panel-client";

const STATUS_RUBBER = { open: "rubber-sent", replied: "rubber-draft", closed: "rubber-void" } as const;

/**
 * One ticket as a coupon: head (number, subject, customer, received, source, status, urgency,
 * category, owner), the customer's message, the thread of sent replies (carbon copies), AI
 * triage, and the reply composer beside its source article. Used by /tickets/[id] and the
 * inbox's right pane.
 */
export async function TicketView({ id, embedded = false }: { id: number; embedded?: boolean }) {
  const [ticket, user] = await Promise.all([getTicket(id), getPageUser()]);
  if (!ticket || !user) {
    if (!embedded) notFound();
    return (
      <p className="coupon-quiet p-6 text-sm text-ink-2">
        Ticket <span className="num">#{id}</span> does not exist. Pick another ticket from the list.
      </p>
    );
  }
  const admin = isAdmin(user);
  const [replies, latest, users] = await Promise.all([
    listReplies(ticket.id),
    getLatestAttempt(ticket.id),
    admin ? listAssignableUsers() : Promise.resolve([]),
  ]);
  const triage = ticket.currentTriage;
  const initialTriage = latest ? ({ ...latest, createdAt: latest.createdAt.toISOString() } as TriageViewJson) : null;
  const headingId = `ticket-${ticket.id}-subject`;

  return (
    <article aria-labelledby={headingId} className="space-y-5" data-embedded={embedded || undefined}>
      <div>
        <div className="tab-row pl-4">
          <span className="tab" data-tone="navy">
            Ticket <TicketNo id={ticket.id} className="!text-white" />
          </span>
          <span className="tab">
            <SourceLabel source={ticket.source} withIcon />
          </span>
          {triage && (
            <span className="tab" data-tone={triage.urgency === "high" ? "red" : undefined}>
              {LABELS.urgency[triage.urgency]} urgency
            </span>
          )}
        </div>

        <div className="coupon">
          <header className="relative p-4 pb-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                <h1 id={headingId} className="text-xl font-semibold leading-snug text-ink sm:text-2xl">
                  {ticket.subject}
                </h1>
                <p className="mt-1 text-sm text-ink-2">
                  From <span className="font-medium text-ink">{ticket.customerName ?? ticket.customerEmail}</span>
                  {ticket.customerName && <span className="text-ink-2"> &lt;{ticket.customerEmail}&gt;</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className={`rubber ${STATUS_RUBBER[ticket.status]}`} style={{ ["--rubber-rot" as string]: "-3deg" }}>
                  <span className="rubber-word text-lg">{LABELS.status[ticket.status]}</span>
                  <span className="rubber-meta num !text-current">{stampTime(ticket.updatedAt)}</span>
                </div>
                <TicketActions ticketId={ticket.id} status={ticket.status} canClose={admin || replies.length > 0} admin={admin} />
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 border-t border-rule sm:grid-cols-4">
              <Field label="Received">
                <time dateTime={ticket.createdAt.toISOString()} className="num text-sm">
                  {stampTime(ticket.createdAt)}
                </time>
                <span className="ml-1.5 text-xs text-ink-3">({timeAgo(ticket.createdAt)} ago)</span>
              </Field>
              <Field label="Replies sent">
                <span className="num text-sm">{replies.length}</span>
              </Field>
              <Field label="Triage">
                {triage ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <UrgencyTab urgency={triage.urgency} />
                    <CategoryLabel category={triage.category} />
                  </span>
                ) : (
                  <span className="text-sm text-ink-3">Not triaged</span>
                )}
              </Field>
              <Field label="Owner">
                {admin ? (
                  <ReassignForm ticketId={ticket.id} currentAssigneeId={ticket.assignee?.id ?? null} users={users} />
                ) : (
                  <span className={`text-sm ${ticket.assignee ? "font-medium text-ink" : "text-ink-3"}`}>
                    {ticket.assignee?.name ?? "Unassigned"}
                  </span>
                )}
              </Field>
            </dl>
          </header>

          <div className="perf" aria-hidden="true" />

          <section aria-label="Customer message" className="px-4 py-4 sm:px-5">
            <h2 className="field-label mb-2">Customer message</h2>
            <div className="max-w-[72ch] whitespace-pre-wrap break-words text-ink">{ticket.body}</div>
          </section>
        </div>
      </div>

      <Thread replies={replies} />

      <TriagePanelClient ticketId={ticket.id} initial={initialTriage} canRegenerate={admin} />

      <WithArticlePanel grounding={ticket.grounding} wide={!embedded}>
        <ReplyEditor
          ticketId={ticket.id}
          draft={triage && { triageId: triage.id, text: triage.draft }}
          closed={ticket.status === "closed"}
        />
      </WithArticlePanel>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-rule-soft py-2 pr-3 sm:border-b-0 sm:border-r sm:px-3 sm:first:pl-0 sm:last:border-r-0">
      <dt className="field-label">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
