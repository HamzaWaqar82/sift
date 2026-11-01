import type { Message } from "@/lib/messages";
import { stampTime } from "../../_components/ticket-labels";
import { SentStamp } from "./sent-stamp";

/**
 * The conversation after the opening message, oldest first. Each sent reply is a lilac carbon
 * copy stamped SENT with who and when, and whether the AI draft was sent as-is or edited. Each
 * later customer message is plain white paper ruled in navy, so the two sides never blur.
 */
export function Thread({ messages, customer }: { messages: Message[]; customer: string }) {
  if (messages.length === 0) return null;
  return (
    <section aria-label="Conversation" className="space-y-3">
      <h2 className="caps text-sm text-ink-2">
        Conversation <span className="num text-xs">{messages.length}</span>
      </h2>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id}>{m.direction === "outbound" ? <CarbonCopy m={m} /> : <CustomerMessage m={m} customer={customer} />}</li>
        ))}
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

function CarbonCopy({ m }: { m: Message }) {
  const name = m.author?.name ?? "Former staff";
  return (
    <article
      aria-label={`Reply sent by ${name}`}
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
          <SentStamp sentKey={m.idempotencyKey} name={name} time={stampTime(m.occurredAt)} iso={m.occurredAt.toISOString()} />
        </div>
      </div>
    </article>
  );
}
