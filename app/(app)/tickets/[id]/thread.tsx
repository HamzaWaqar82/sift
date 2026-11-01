import type { Message } from "@/lib/messages";
import type { InternalNote } from "@/lib/notes";
import { stampTime } from "../../_components/ticket-labels";
import { DeliveryState } from "./delivery-state";
import { SentStamp } from "./sent-stamp";

/**
 * The conversation after the opening message, oldest first. Each sent reply is a lilac carbon
 * copy stamped SENT with who and when, and whether the AI draft was sent as-is or edited. Each
 * later customer message is plain white paper ruled in navy, so the two sides never blur.
 */
export function Thread({
  messages,
  notes = [],
  customer,
  canRetry = false,
}: {
  messages: Message[];
  notes?: InternalNote[];
  customer: string;
  /** The viewer may retry a failed reply (the owner or an admin). */
  canRetry?: boolean;
}) {
  // Notes sit inline by time. They are a separate kind of entry, never part of `messages`.
  const items = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.occurredAt, id: m.id, m })),
    ...notes.map((n) => ({ kind: "note" as const, at: n.createdAt, id: n.id, n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? a.id - b.id : a.kind === "message" ? -1 : 1));
  if (items.length === 0) return null;
  return (
    <section aria-label="Conversation" className="space-y-3">
      <h2 className="caps text-sm text-ink-2">
        Conversation <span className="num text-xs">{items.length}</span>
      </h2>
      <ol className="space-y-3">
        {items.map((it) =>
          it.kind === "note" ? (
            <li key={`n${it.id}`}>
              <NoteCard n={it.n} />
            </li>
          ) : (
            <li key={`m${it.id}`}>
              {it.m.direction === "outbound" ? <CarbonCopy m={it.m} canRetry={canRetry} /> : <CustomerMessage m={it.m} customer={customer} />}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function CustomerMessage({ m, customer }: { m: Message; customer: string }) {
  return (
    <article aria-label={`Message from ${customer}`} className="rounded-[var(--radius-coupon)] border border-ink/30 bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-ink-3 px-4 py-2">
        <p className="text-sm text-ink">
          <span className="font-semibold">{customer}</span>
          <span className="text-ink-2"> wrote</span>
        </p>
        <time dateTime={m.occurredAt.toISOString()} className="num text-xs">
          {stampTime(m.occurredAt)}
        </time>
      </div>
      <div className="max-w-[72ch] whitespace-pre-wrap break-words px-4 py-4 text-ink">{m.bodyText}</div>
    </article>
  );
}

/** A staff-only note: lilac like a carbon copy, but dashed and labelled so it never reads as sent. */
function NoteCard({ n }: { n: InternalNote }) {
  return (
    <article aria-label={`Internal note by ${n.author.name}`} className="rounded-[var(--radius-coupon)] border border-dashed border-carbon/50 bg-lilac-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-carbon/50 px-4 py-2">
        <p className="text-sm text-ink">
          <span className="font-semibold">{n.author.name}</span>
          <span className="text-ink-2"> noted</span>
        </p>
        <span className="flex items-center gap-3">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-carbon">Internal note</span>
          <time dateTime={n.createdAt.toISOString()} className="num text-xs">
            {stampTime(n.createdAt)}
          </time>
        </span>
      </div>
      <div className="max-w-[72ch] whitespace-pre-wrap break-words px-4 py-4 text-ink">{n.body}</div>
    </article>
  );
}

function CarbonCopy({ m, canRetry }: { m: Message; canRetry: boolean }) {
  const name = m.author?.name ?? "Former staff";
  return (
    <article
      aria-label={m.status === "sent" ? `Reply sent by ${name}` : `Reply by ${name}, ${m.status}`}
      className="relative overflow-hidden rounded-[var(--radius-coupon)] border border-carbon/40 bg-lilac"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-carbon/50 px-4 py-2">
        <p className="text-sm text-ink">
          <span className="font-semibold">{name}</span>
          <span className="text-ink-2"> replied</span>
        </p>
        <span className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-carbon">
          {m.aiDraft === null ? "Written by hand" : m.edited ? "AI draft, edited" : "AI draft, unedited"}
        </span>
      </div>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_auto]">
        <div className="max-w-[72ch] whitespace-pre-wrap break-words text-ink">{m.bodyText}</div>
        <div className="self-start justify-self-end sm:pt-1">
          {m.status === "sent" ? (
            <SentStamp sentKey={m.idempotencyKey} name={name} time={stampTime(m.occurredAt)} iso={m.occurredAt.toISOString()} />
          ) : (
            <DeliveryState ticketId={m.ticketId} messageId={m.id} status={m.status ?? "queued"} lastError={m.lastError} canRetry={canRetry} />
          )}
        </div>
      </div>
    </article>
  );
}
