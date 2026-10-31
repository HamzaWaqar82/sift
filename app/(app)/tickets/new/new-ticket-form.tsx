"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Fields = Partial<Record<"customerEmail" | "customerName" | "subject" | "body", string>>;

const inputClass = (invalid: boolean) =>
  `mt-1 block w-full rounded-md border px-3 py-2 focus:outline-none ${
    invalid ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-slate-500"
  }`;

export function NewTicketForm() {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerEmail: form.get("customerEmail"),
          customerName: form.get("customerName"),
          subject: form.get("subject"),
          body: form.get("body"),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/tickets/${json.ticket.id}`);
        return;
      }
      setFields(json.fields ?? {});
      setError(json.error ?? "Could not create the ticket");
    } catch {
      setError("Could not reach the server");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer email" name="customerEmail" error={fields.customerEmail}>
          <input
            id="customerEmail"
            name="customerEmail"
            type="email"
            aria-invalid={!!fields.customerEmail}
            className={inputClass(!!fields.customerEmail)}
          />
        </Field>
        <Field label="Customer name (optional)" name="customerName" error={fields.customerName}>
          <input id="customerName" name="customerName" className={inputClass(!!fields.customerName)} />
        </Field>
      </div>
      <Field label="Subject" name="subject" error={fields.subject}>
        <input id="subject" name="subject" aria-invalid={!!fields.subject} className={inputClass(!!fields.subject)} />
      </Field>
      <Field label="Message" name="body" error={fields.body}>
        <textarea
          id="body"
          name="body"
          rows={8}
          aria-invalid={!!fields.body}
          className={inputClass(!!fields.body)}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create ticket"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="text-sm">
      <label htmlFor={name} className="font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
