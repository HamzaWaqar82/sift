import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hrefWith, pageSizeOf, trailOf } from "../_lib/params";
import { PageSizeSelect } from "./page-size-select";

/**
 * Cursor pager. Next appends the current cursor to `trail` (a stack of earlier cursors in the URL)
 * and moves to the next cursor; Previous pops the trail. So "Showing 41–60" is exact and Previous
 * works after a reload or a shared link.
 */
export function Pager({
  params,
  count,
  total,
  nextCursor,
  pageIndex,
  compact = false,
}: {
  params: Record<string, string>;
  count: number;
  total: number;
  nextCursor: string | null;
  pageIndex: number;
  compact?: boolean;
}) {
  const size = pageSizeOf(params);
  const trail = trailOf(params);
  const start = pageIndex * size + 1;
  const end = pageIndex * size + count;

  const nextHref = nextCursor
    ? hrefWith(params, { cursor: nextCursor, trail: [...trail, params.cursor ?? "_"].join(".") })
    : null;
  const prevCursor = trail.at(-1);
  const prevHref =
    trail.length > 0
      ? hrefWith(params, { cursor: prevCursor === "_" ? null : prevCursor, trail: trail.slice(0, -1).join(".") || null })
      : null;

  return (
    <nav aria-label="Pages" className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${compact ? "justify-between" : ""}`}>
      <p className="text-sm text-ink-2" aria-live="polite">
        Showing{" "}
        <span className="num font-medium">
          {start}–{end}
        </span>{" "}
        of <span className="num font-medium">{Math.max(total, end)}</span>
      </p>
      <PageSizeSelect params={params} size={size} />
      <div className={`flex items-center gap-1.5 ${compact ? "" : "ml-auto"}`}>
        <PageLink href={prevHref} label="Previous" icon="prev" />
        <PageLink href={nextHref} label="Next" icon="next" />
      </div>
    </nav>
  );
}

function PageLink({ href, label, icon }: { href: string | null; label: string; icon: "prev" | "next" }) {
  const content = (
    <>
      {icon === "prev" && <ChevronLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />}
      {label}
      {icon === "next" && <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden="true" />}
    </>
  );
  if (!href) {
    return (
      <span className="btn btn-sm" aria-disabled="true">
        {content}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} className="btn btn-sm" rel={icon}>
      {content}
    </Link>
  );
}
