import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { devMailboxEnabled } from "@/lib/mail";
import { getCapturedMail, listCapturedMail } from "@/lib/mail/mailbox";
import { stampTime } from "../../_components/ticket-labels";
import { SendTestEmail } from "./send-test-email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev mailbox" };

/**
 * Mail kept by the `capture` transport (dev and staging): newest first, with the selected
 * message's headers, text, HTML and raw source. Does not exist in production.
 */
export default async function DevMailboxPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!devMailboxEnabled()) notFound();
  const user = await requirePageUser();

  const mails = await listCapturedMail();
  const requested = Number((await searchParams).id);
  const selectedId = Number.isSafeInteger(requested) && requested > 0 ? requested : mails[0]?.id;
  const selected = selectedId ? await getCapturedMail(selectedId) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="caps-bold text-2xl text-ink">Dev mailbox</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            Email Sift would have sent. Nothing here left the server.
          </p>
        </div>
        {isAdmin(user) && <SendTestEmail />}
      </div>

      {mails.length === 0 ? (
        <p className="coupon-quiet p-6 text-sm text-ink-2">No mail captured yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <ul className="coupon-quiet divide-y divide-rule-soft self-start">
            {mails.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/dev/mailbox?id=${m.id}`}
                  aria-current={m.id === selected?.id ? "true" : undefined}
                  className="block px-3 py-2 hover:bg-navy-hover aria-[current=true]:bg-navy-tint"
                >
                  <span className="block truncate text-sm font-semibold text-ink">{m.subject}</span>
                  <span className="block truncate text-xs text-ink-3">
                    To {m.to} · <span className="num">{stampTime(m.capturedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {selected ? (
            <article className="coupon-quiet min-w-0 p-4">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {selected.headers
                  .filter(([name]) => !/^(content-|mime-version)/i.test(name))
                  .map(([name, value], i) => (
                    <div key={i} className="contents">
                      <dt className="text-ink-3">{name}</dt>
                      <dd className="break-words font-mono text-xs leading-5 text-ink">{value}</dd>
                    </div>
                  ))}
              </dl>
              <pre className="mt-4 whitespace-pre-wrap break-words border-t border-rule-soft pt-4 font-sans text-sm text-ink">
                {selected.text}
              </pre>
              {selected.html && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-ink-2">HTML version</summary>
                  {/* Empty sandbox: no scripts, no same-origin access, no forms. */}
                  <iframe
                    title="HTML version"
                    sandbox=""
                    srcDoc={selected.html}
                    className="mt-2 h-80 w-full border border-rule-soft bg-white"
                  />
                </details>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-ink-2">Raw source</summary>
                <pre className="mt-2 max-h-96 overflow-auto bg-panel-2 p-3 font-mono text-xs text-ink">{selected.raw}</pre>
              </details>
            </article>
          ) : (
            <p className="coupon-quiet p-6 text-sm text-ink-2">That message is not in the mailbox.</p>
          )}
        </div>
      )}
    </div>
  );
}
