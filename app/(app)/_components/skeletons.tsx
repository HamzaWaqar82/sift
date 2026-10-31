/** Loading placeholders shaped like the content they stand in for (never a spinner). */

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-3 pb-3 lg:px-4" aria-busy="true" aria-label="Loading tickets" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[4.25rem_1fr] overflow-hidden rounded-[var(--radius-coupon)] border border-rule-soft bg-panel">
          <div className="space-y-2 border-r border-dashed border-rule-soft bg-panel-2 px-2.5 py-2.5">
            <div className="skel h-3 w-10" />
            <div className="skel h-3 w-6" />
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <div className="skel h-3.5" style={{ width: `${60 + ((i * 17) % 30)}%` }} />
            <div className="skel h-3 w-2/5" />
            <div className="skel h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="coupon overflow-hidden" aria-busy="true" aria-label="Loading tickets" role="status">
      <div className="h-9 border-b border-rule bg-panel-2" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-rule-soft px-3 py-3 last:border-b-0">
          <div className="skel h-3 w-12" />
          <div className="skel h-3.5" style={{ width: `${22 + ((i * 13) % 14)}%` }} />
          <div className="skel h-3 w-28" />
          <div className="skel h-4 w-16" />
          <div className="skel h-4 w-14" />
          <div className="skel ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Loading board" role="status">
      {[0, 1, 2].map((c) => (
        <div key={c}>
          <div className="ml-3 h-[1.625rem] w-24 skel" />
          <div className="space-y-2 rounded-[var(--radius-coupon)] border border-rule-soft bg-panel-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2 rounded-[var(--radius-coupon)] border border-rule-soft bg-panel p-3">
                <div className="skel h-3 w-14" />
                <div className="skel h-3.5 w-4/5" />
                <div className="skel h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading ticket" role="status">
      <div className="ml-4 h-[1.625rem] w-28 skel" />
      <div className="coupon space-y-3 p-5">
        <div className="skel h-3 w-20" />
        <div className="skel h-6 w-3/5" />
        <div className="grid grid-cols-4 gap-4 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="skel h-2.5 w-12" />
              <div className="skel h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="coupon space-y-2 p-5">
        {[90, 95, 70, 85, 40].map((w, i) => (
          <div key={i} className="skel h-3.5" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
