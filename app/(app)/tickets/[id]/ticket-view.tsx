import { notFound } from "next/navigation";
import { getPageUser, isAdmin } from "@/lib/auth";
import { listMessages } from "@/lib/messages";
import { getTicket, listAssignableUsers } from "@/lib/tickets";
import { getLatestAttempt } from "@/lib/triage";
import { LABELS } from "../../_lib/params";
import { JustReplied } from "../../_components/live-updates";
import { stampTime, timeAgo } from "../../_components/ticket-labels";
import { WithArticlePanel } from "./article-panel";
import { TicketActions } from "./close-button";
import { CappedText } from "./capped-text";
import { ReassignForm } from "./reassign-form";
import { ReplyEditor } from "./reply-editor";
import { Thread } from "./thread";
import { TriagePanelClient, type TriageViewJson } from "./triage-panel-client";

const STATUS_RUBBER = { open: "rubber-sent", replied: "rubber-draft", closed: "rubber-void" } as const;

/**
 * One ticket as a coupon: head (number, subject, customer, received, source, status, urgency,
 * category, owner), the opening customer message, the rest of the conversation (customer messages
 * and sent replies as carbon copies), AI
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
  const [messages, latest, users] = await Promise.all([
    listMessages(ticket.id),
    getLatestAttempt(ticket.id),
    admin ? listAssignableUsers() : Promise.resolve([]),
  ]);
  // The opening customer message sits on the coupon; everything after it is the thread.
  const [opening, ...thread] = messages;
  const replyCount = messages.filter((m) => m.direction === "outbound" && m.status === "sent").length;
  const triage = ticket.currentTriage;
  const initialTriage = latest ? ({ ...latest, createdAt: latest.createdAt.toISOString() } as TriageViewJson) : null;
  const headingId = `ticket-${ticket.id}-subject`;

  return (
    <article aria-labelledby={headingId} className="space-y-5" data-embedded={embedded || undefined}>
      <div>
        <div className="tab-row pl-4">
          <span className="tab" data-tone="navy">
            {ticket.source === "webhook" ? "Email" : "Form"} ticket
          </span>
          {triage ? (
            <>
              <span className="tab" data-tone={triage.urgency === "high" ? "red" : undefined}>
                {LABELS.urgency[triage.urgency]} urgency
              </span>
              <span className="tab">{LABELS.category[triage.category]}</span>
            </>
          ) : (
            <span className="tab" data-tone="ground">
              Not triaged
            </span>
          )}
        </div>

        <div className="coupon">
          <header className="grid md:grid-cols-[auto_1fr]">
            {/* Stub: the ticket number at display scale, like a flight code on a coupon. */}
            <div className="flex items-end justify-between gap-3 border-b border-dashed border-ink-3 bg-panel-2 px-4 py-3 md:flex-col md:items-start md:justify-start md:rounded-tl-[var(--radius-coupon)] md:border-b-0 md:px-5 md:py-4">
              <div>
                <p className="field-label">Ticket</p>
                <p
                  className="font-display text-[2.75rem] font-bold leading-[0.9] tracking-[0.01em] text-carbon [font-variant-numeric:tabular-nums] md:text-[3.5rem]"
                  aria-label={`Ticket ${ticket.id}`}
                >
                  <span className="text-[0.55em] align-top text-carbon/70">#</span>
                  {String(ticket.id).padStart(4, "0")}
                </p>
              </div>
              <div className="md:mt-3">
                <p className="field-label">Received</p>
                <time dateTime={ticket.createdAt.toISOString()} className="num block text-xs">
                  {stampTime(ticket.createdAt)}
                </time>
              </div>
            </div>
            <div className="perf-v min-w-0 p-4 md:px-5">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 flex-1">
                  <h1 id={headingId} className="text-xl font-semibold leading-snug text-ink sm:text-2xl">
                    {ticket.subject}
                  </h1>
                  <p className="mt-1 text-sm text-ink-2">
                    From <span className="font-medium text-ink">{ticket.customerName ?? ticket.customerEmail}</span>
                    {ticket.customerName && <span className="text-ink-2"> &lt;{ticket.customerEmail}&gt;</span>}
                  </p>
                  <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <dt className="field-label">Age</dt>
                      <dd className="num text-xs">{timeAgo(ticket.createdAt)}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="field-label">Replies</dt>
                      <dd className="num text-xs">{replyCount}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="field-label">Owner</dt>
                      <dd>
                        {admin ? (
                          <ReassignForm ticketId={ticket.id} currentAssigneeId={ticket.assignee?.id ?? null} users={users} />
                        ) : (
                          <span className={ticket.assignee ? "font-medium text-ink" : "text-ink-2"}>{ticket.assignee?.name ?? "Unassigned"}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-3">
                  <div className={`rubber ${STATUS_RUBBER[ticket.status]}`} style={{ ["--rubber-rot" as string]: "-3deg" }}>
                    <span className="rubber-word text-lg">{ticket.status === "closed" ? "Void" : LABELS.status[ticket.status]}</span>
                    <span className="rubber-meta">{ticket.status === "closed" ? "Closed " : ""}<span className="font-mono normal-case tracking-normal">{stampTime(ticket.updatedAt)}</span></span>
                  </div>
                  <TicketActions ticketId={ticket.id} status={ticket.status} canClose={admin || replyCount > 0} admin={admin} />
                </div>
              </div>
            </div>
          </header>

          <div className="perf" aria-hidden="true" />

          <section aria-label="Customer message" className="px-4 py-4 sm:px-5">
            <h2 className="field-label mb-2">Customer message</h2>
            <CappedText text={opening?.bodyText ?? ticket.body} compact={embedded} />
          </section>
        </div>
      </div>

      <Thread messages={thread} customer={ticket.customerName ?? ticket.customerEmail} />

      <JustReplied key={ticket.id} ticketId={ticket.id} />

      <TriagePanelClient ticketId={ticket.id} initial={initialTriage} canRegenerate={admin} />

      <WithArticlePanel grounding={ticket.grounding} wide={!embedded}>
        <ReplyEditor
          ticketId={ticket.id}
          draft={triage && { triageId: triage.id, text: triage.draft }}
          closed={ticket.status === "closed"}
          compact={embedded}
        />
      </WithArticlePanel>
    </article>
  );
}
