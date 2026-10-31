"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CircleCheck, RotateCcw, Send } from "lucide-react";
import { JUST_SENT_KEY } from "./sent-stamp";

const MAX = 20_000;

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The current triage's draft and the id of the triage result it came from. */
export type EditorDraft = { triageId: number; text: string };

/**
 * Reply box, prefilled with the AI draft when one exists. Sending is an explicit click.
 * One idempotency key per compose session, so a double click or retry records one reply.
 * The send carries the id of the triage result whose draft the box started from, so the server
 * records that draft and computes `edited` against it even if a newer draft arrived meanwhile.
 */
export function ReplyEditor({
  ticketId,
  draft,
  closed = false,
  compact = false,
}: {
  ticketId: number;
  draft: EditorDraft | null;
  closed?: boolean;
  /** Inbox pane: a shorter box so the draft, article and Send fit the first viewport. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [touched, setTouched] = useState(false);
  const [latestDraftId, setLatestDraftId] = useState(draft?.triageId ?? null);
  // The triage result the box's text started from; null once it is a hand-written reply.
  const [baseDraftId, setBaseDraftId] = useState(draft?.triageId ?? null);
  const [baseText, setBaseText] = useState(draft?.text ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const key = useRef<string | null>(null);
  const sending = useRef(false);

  // A new draft (e.g. triage just ran) replaces the box only if the agent has not typed yet.
  if ((draft?.triageId ?? null) !== latestDraftId) {
    setLatestDraftId(draft?.triageId ?? null);
    if (!touched) {
      setText(draft?.text ?? "");
      setBaseDraftId(draft?.triageId ?? null);
      setBaseText(draft?.text ?? null);
    }
  }

  const fromDraft = baseDraftId !== null && baseText !== null;
  const edited = fromDraft && text !== baseText;
  const state = !fromDraft ? "hand" : edited ? "edited" : "unedited";

  async function send() {
    if (sending.current) return;
    if (!text.trim()) {
      setError("Reply cannot be empty");
      return;
    }
    sending.current = true;
    key.current ??= newKey();
    setPending(true);
    setError(null);
    setSent(false);
    const res = await fetch(`/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, idempotencyKey: key.current, draftTriageId: baseDraftId }),
    }).catch(() => null);
    if (res?.ok) {
      const json = await res.json().catch(() => null);
      if (json?.reply?.id) sessionStorage.setItem(JUST_SENT_KEY, String(json.reply.id));
      key.current = null;
      setText("");
      setTouched(true);
      setBaseDraftId(null);
      setBaseText(null);
      setSent(true);
      router.refresh();
    } else {
      const json = await res?.json().catch(() => null);
      setError(json?.fields?.body ?? json?.error ?? "Could not send the reply. Try again.");
    }
    sending.current = false;
    setPending(false);
  }

  return (
    <form
      aria-label="Reply"
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="tab-row pl-3">
        <span className="tab" data-tone="navy">
          Reply
        </span>
        {fromDraft && (
          <span className="stamp mb-1 ml-2 self-center" data-state="replied">
            {state === "edited" ? "Draft, edited" : "AI draft"}
          </span>
        )}
        <p id={`reply-${ticketId}-hint`} className="mb-1 ml-2 min-w-0 self-center truncate text-xs text-ink-2">
          {state === "unedited" && "Check it against the source article before sending."}
          {state === "edited" && "Will be recorded as an edited AI draft."}
          {state === "hand" && "Written by hand."}
        </p>
      </div>
      <div className="coupon">
        <label htmlFor={`reply-${ticketId}`} className="sr-only">
          Reply to the customer
        </label>
        <textarea
          id={`reply-${ticketId}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTouched(true);
            setSent(false);
            if (error) setError(null);
          }}
          rows={7}
          maxLength={MAX}
          placeholder={draft ? "Write a reply…" : "Write a reply, or run AI triage above for a draft to start from…"}
          aria-invalid={!!error || undefined}
          aria-describedby={`reply-${ticketId}-hint`}
          className={`block w-full ${compact ? "max-h-[13rem] min-h-[8rem]" : "max-h-[24rem] min-h-[10rem]"} resize-y overflow-y-auto rounded-t-[var(--radius-coupon)] border-0 bg-panel px-4 pb-5 pt-3 leading-relaxed text-ink [field-sizing:content] focus:shadow-[inset_0_0_0_2px_var(--color-ink)] focus:outline-none`}
        />
        {/* The textarea scrolls inside its own box (bottom padding), so text never runs under this footer. */}
        <div className="perf" style={{ ["--perf-bg" as string]: "var(--color-ground)" }} aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
          <p className="min-w-0 text-xs text-ink-2">
            {closed ? "Sending reopens this closed ticket. " : ""}Recorded in Sift; no email is sent.
            <span className="num ml-1.5">
              {text.length.toLocaleString("en-US")}/{MAX.toLocaleString("en-US")}
            </span>
          </p>
          <div className="flex items-center gap-2">
            {edited && !pending && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setText(baseText ?? "");
                  setError(null);
                }}
              >
                <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                Restore draft
              </button>
            )}
            <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-send">
              <Send className="size-4" strokeWidth={1.5} aria-hidden="true" />
              {pending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
      <div aria-live="polite" className="mt-2 empty:hidden">
        {error && (
          <p role="alert" className="text-sm text-jet-ink">
            {error}
          </p>
        )}
        {sent && !error && (
          <p className="flex items-center gap-1.5 text-sm text-ok-ink">
            <CircleCheck className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Reply sent and stamped in the thread.
          </p>
        )}
      </div>
    </form>
  );
}
