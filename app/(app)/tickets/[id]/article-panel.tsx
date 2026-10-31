import type { ReactNode } from "react";
import type { Grounding } from "@/lib/tickets";

/**
 * Lays out the reply editor (children) with the help article its draft is based on beside it
 * (side by side on wide screens, stacked on narrow ones).
 */
export function WithArticlePanel({ grounding, children }: { grounding: Grounding; children: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0">{children}</div>
      <ArticlePanel grounding={grounding} />
    </div>
  );
}

/** The help article behind the latest valid AI draft, or an "ungrounded" warning. */
export function ArticlePanel({ grounding }: { grounding: Grounding }) {
  if (!grounding) {
    return (
      <aside aria-label="Help article" className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        The help article behind the AI draft appears here after a triage.
      </aside>
    );
  }

  if (!grounding.article) {
    return (
      <aside aria-label="Help article" className="rounded-lg border border-amber-300 bg-amber-50 p-4" role="note">
        <p className="font-medium text-amber-900">Not grounded — review carefully</p>
        <p className="mt-1 text-sm text-amber-800">The AI draft is not based on any help article.</p>
      </aside>
    );
  }

  const { article } = grounding;
  return (
    <aside aria-label="Help article" className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Draft based on help article</p>
      <h2 className="mt-1 font-semibold text-slate-900">{article.title}</h2>
      <p className="text-xs text-slate-400">{article.id}</p>
      <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-700">
        {article.body}
      </div>
    </aside>
  );
}
