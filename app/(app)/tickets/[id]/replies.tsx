import type { Reply } from "@/lib/replies";
import { stampTime } from "../../_components/ticket-labels";
import { SentStamp } from "./sent-stamp";

/**
 * The thread: each sent reply as a lilac carbon copy, stamped SENT with who and when, and whether
 * the AI draft was sent as-is or edited.
 */
export function Thread({ replies }: { replies: Reply[] }) {
  if (replies.length === 0) return null;
  return (
    <section aria-label="Sent replies" className="space-y-3">
      <h2 className="caps text-sm text-ink-2">
        Sent replies <span className="num text-xs">{replies.length}</span>
      </h2>
      <ol className="space-y-3">
        {replies.map((r) => (
          <li key={r.id}>
            <article
              aria-label={`Reply sent by ${r.sentBy.name}`}
              className="relative overflow-hidden rounded-[var(--radius-coupon)] border border-carbon/40 bg-lilac"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-carbon/50 px-4 py-2">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{r.sentBy.name}</span>
                  <span className="text-ink-2"> replied</span>
                </p>
                <span className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-carbon">
                  {r.aiDraft === null ? "Written by hand" : r.edited ? "AI draft, edited" : "AI draft, unedited"}
                </span>
              </div>
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_auto]">
                <div className="max-w-[72ch] whitespace-pre-wrap break-words text-ink">{r.finalBody}</div>
                <div className="self-start justify-self-end sm:pt-1">
                  <SentStamp replyId={r.id} name={r.sentBy.name} time={stampTime(r.sentAt)} iso={r.sentAt.toISOString()} />
                </div>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
