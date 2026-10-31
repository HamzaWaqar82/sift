import { Wordmark } from "./logo";

/** A cancelled coupon for 404s and errors: nothing disappears, it is stamped VOID. */
export function VoidCoupon({
  code,
  title,
  children,
  actions,
}: {
  code: string;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="tab-row pl-4">
        <span className="tab" data-tone="red">
          {code}
        </span>
      </div>
      <div className="coupon">
        <div className="flex items-start justify-between gap-4 p-6">
          <Wordmark />
          <div className="rubber rubber-void" style={{ ["--rubber-rot" as string]: "-7deg" }}>
            <span className="rubber-word text-2xl">Void</span>
          </div>
        </div>
        <div className="perf" aria-hidden="true" />
        <div className="p-6">
          <h1 className="caps-bold text-2xl text-ink">{title}</h1>
          <div className="mt-2 text-ink-2">{children}</div>
          <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
        </div>
      </div>
    </div>
  );
}
