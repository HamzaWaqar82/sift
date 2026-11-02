"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";

export type JsonFormField = {
  name: string;
  label: string;
  type?: "email" | "password";
  autoComplete?: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
};

/**
 * A small form that POSTs its fields (plus `extra`, e.g. a link's token) as JSON and swaps itself
 * for a success note: `doneText`, else the server's `message`, plus a sign-in link if `signInAfter`.
 * Errors show the server's field message or error text.
 */
export function JsonForm({
  endpoint,
  fields,
  extra = {},
  submitLabel,
  pendingLabel,
  doneText,
  signInAfter = false,
}: {
  endpoint: string;
  fields: JsonFormField[];
  extra?: Record<string, string>;
  submitLabel: string;
  pendingLabel: string;
  doneText?: string;
  signInAfter?: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ message?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setProblem(null);
    const form = new FormData(e.currentTarget);
    const values = Object.fromEntries(fields.map((f) => [f.name, String(form.get(f.name) ?? "")]));
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(body);
        return;
      }
      const fieldMessage = fields.map((f) => body.fields?.[f.name]).find(Boolean);
      setProblem(fieldMessage ?? body.error ?? "Something went wrong. Try again.");
    } catch {
      setProblem("Could not reach Sift. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="mt-6 space-y-4" aria-live="polite">
        <p role="status" className="text-sm text-ink">
          {doneText ?? result.message}
        </p>
        {signInAfter && (
          <a href="/sign-in" className="btn btn-navy w-full">
            Go to sign in
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="label">
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            required
            minLength={f.minLength}
            maxLength={f.maxLength}
            className="input"
          />
          {f.hint && <p className="mt-1 text-xs text-ink-3">{f.hint}</p>}
        </div>
      ))}
      <div aria-live="polite">
        {problem && (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-jet-tint px-3 py-2 text-sm text-jet-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {problem}
          </p>
        )}
      </div>
      <button type="submit" disabled={pending} className="btn btn-navy w-full" aria-busy={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
