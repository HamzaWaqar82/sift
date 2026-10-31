import type { ReactNode } from "react";
import { BookOpen, TriangleAlert } from "lucide-react";
import type { Grounding } from "@/lib/tickets";

/**
 * Lays out the reply editor (children) with the help article its draft is based on beside it
 * (side by side on wide screens, stacked on narrow ones).
 */
export function WithArticlePanel({ grounding, children, wide = true }: { grounding: Grounding; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`grid gap-4 ${wide ? "lg:grid-cols-[1.2fr_1fr]" : "xl:grid-cols-[1.2fr_1fr]"} lg:items-start`}>
      <div className="min-w-0">{children}</div>
      <ArticlePanel grounding={grounding} />
    </div>
  );
}

/** The help article behind the latest valid AI draft, or an "ungrounded" warning. */
export function ArticlePanel({ grounding }: { grounding: Grounding }) {
  if (!grounding) {
    return (
      <aside aria-label="Help article" className="rounded-[var(--radius-coupon)] border border-dashed border-ink-3 p-4 text-sm text-ink-2">
        <p className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
          <BookOpen className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Source article
        </p>
        <p className="mt-2">The help article behind the AI draft appears here after a triage, so you can check the draft against it.</p>
      </aside>
    );
  }

  if (!grounding.article) {
    return (
      <aside aria-label="Help article" className="rounded-[var(--radius-coupon)] border border-warn-ink bg-warn-tint p-4" role="note">
        <p className="flex items-center gap-2 font-semibold text-warn-ink">
          <TriangleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          Not grounded — review carefully
        </p>
        <p className="mt-1 text-sm text-warn-ink">
          The AI draft is not based on any help article. Check every fact, price and step before you send it.
        </p>
      </aside>
    );
  }

  const { article } = grounding;
  return (
    <aside aria-label="Help article" className="min-w-0">
      <div className="tab-row pl-3">
        <span className="tab">
          <BookOpen className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          Source article
        </span>
      </div>
      <div className="coupon">
        <div className="border-b border-rule-soft px-4 py-3">
          <h2 className="font-semibold leading-snug text-ink">{article.title}</h2>
          <p className="num mt-0.5 text-xs">{article.id}</p>
        </div>
        <div className="max-h-[26rem] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed text-ink-2">
          {article.body}
        </div>
      </div>
    </aside>
  );
}
