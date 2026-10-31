"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert } from "lucide-react";

type Key = "customerEmail" | "customerName" | "subject" | "body";
type Values = Record<Key, string>;
type Errors = Partial<Record<Key, string>>;

/** Same limits and messages as the server's ticketFormSchema (lib/tickets/schema.ts). */
const LIMITS = { customerName: 200, subject: 200, body: 20_000, customerEmail: 254 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fmt = (n: number) => n.toLocaleString("en-US");

function validate(v: Values): Errors {
  const e: Errors = {};
  const email = v.customerEmail.trim();
  if (!email || email.length > LIMITS.customerEmail || !EMAIL.test(email)) e.customerEmail = "Enter a valid email address";
  if (v.customerName.trim().length > LIMITS.customerName) e.customerName = `Name must be ${fmt(LIMITS.customerName)} characters or fewer`;
  if (!v.subject.trim()) e.subject = "Subject is required";
  else if (v.subject.trim().length > LIMITS.subject) e.subject = `Subject must be ${fmt(LIMITS.subject)} characters or fewer`;
  if (!v.body.trim()) e.body = "Message is required";
  else if (v.body.trim().length > LIMITS.body) e.body = `Message must be ${fmt(LIMITS.body)} characters or fewer`;
  return e;
}

export function NewTicketForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({ customerEmail: "", customerName: "", subject: "", body: "" });
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [serverFields, setServerFields] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const local = validate(values);
  const shown = (k: Key) => serverFields[k] ?? (touched[k] ? local[k] : undefined);

  function set(k: Key, v: string) {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (serverFields[k]) setServerFields(({ [k]: _drop, ...rest }) => rest);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ customerEmail: true, customerName: true, subject: true, body: true });
    const errs = validate(values);
    if (Object.keys(errs).length) {
      setError("Fix the highlighted fields, then create the ticket.");
      const first = (["customerEmail", "customerName", "subject", "body"] as Key[]).find((k) => errs[k]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/tickets/${json.ticket.id}`);
        return;
      }
      setServerFields(json.fields ?? {});
      setError(json.error ?? "Could not create the ticket");
    } catch {
      setError("Could not reach the server. Your text is still here; try again.");
    }
    setPending(false);
  }

  const field = (k: Key) => ({
    id: k,
    name: k,
    value: values[k],
    "aria-invalid": !!shown(k) || undefined,
    "aria-describedby": [shown(k) ? `${k}-error` : null, `${k}-hint`].filter(Boolean).join(" "),
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    className: "input",
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="tab-row pl-4">
        <span className="tab" data-tone="navy">
          Phone or chat
        </span>
        <span className="tab">Source: Form</span>
      </div>
      <div className="coupon">
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field k="customerEmail" label="Customer email" error={shown("customerEmail")} help="Replies are recorded against this address.">
            <input {...field("customerEmail")} type="email" autoComplete="off" placeholder="jordan@example.com" onChange={(e) => set("customerEmail", e.target.value)} />
          </Field>
          <Field
            k="customerName"
            label="Customer name"
            optional
            error={shown("customerName")}
            counter={<Counter n={values.customerName.trim().length} max={LIMITS.customerName} />}
          >
            <input {...field("customerName")} autoComplete="off" placeholder="Jordan Lee" onChange={(e) => set("customerName", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field k="subject" label="Subject" error={shown("subject")} counter={<Counter n={values.subject.trim().length} max={LIMITS.subject} />}>
              <input {...field("subject")} autoComplete="off" placeholder="Can't export last month's report" onChange={(e) => set("subject", e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="perf" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <Field k="body" label="Message" error={shown("body")} counter={<Counter n={values.body.trim().length} max={LIMITS.body} />}>
            <textarea
              {...field("body")}
              rows={10}
              placeholder="Paste or summarise what the customer said…"
              className="input resize-y leading-relaxed"
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule-soft bg-panel-2 px-5 py-3 sm:px-6">
          <div aria-live="polite" className="min-w-0 flex-1">
            {error ? (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-jet-ink">
                <CircleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                {error}
              </p>
            ) : (
              <p className="text-xs text-ink-2">The ticket opens as Open and unassigned. Triage it from the ticket page.</p>
            )}
          </div>
          <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-navy">
            {pending ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  const over = n > max;
  return (
    <span className={`num ${over ? "!text-jet-ink" : ""}`}>
      {fmt(n)}/{fmt(max)}
    </span>
  );
}

function Field({
  k,
  label,
  optional = false,
  error,
  help,
  counter,
  children,
}: {
  k: Key;
  label: string;
  optional?: boolean;
  error?: string;
  help?: string;
  counter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={k} className="label">
        {label}
        {optional && <span className="ml-1.5 font-sans text-xs font-normal normal-case tracking-normal text-ink-3">optional</span>}
      </label>
      {children}
      <div className="mt-1 flex min-h-4 items-start justify-between gap-3 text-xs">
        {error ? (
          <p id={`${k}-error`} className="flex items-center gap-1 text-jet-ink">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {error}
          </p>
        ) : (
          <p className="text-ink-3">{help}</p>
        )}
        <p id={`${k}-hint`} className="shrink-0 text-right text-ink-3">
          {counter}
        </p>
      </div>
    </div>
  );
}
