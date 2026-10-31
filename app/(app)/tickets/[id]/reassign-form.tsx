"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type User = { id: number; name: string; email: string };

/** Admin-only owner picker (agents see the owner's name; the API also refuses them with 403). */
export function ReassignForm({
  ticketId,
  currentAssigneeId,
  users,
}: {
  ticketId: number;
  currentAssigneeId: number | null;
  users: User[];
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(currentAssigneeId === null ? "" : String(currentAssigneeId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/tickets/${ticketId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigneeId: value === "" ? null : Number(value) }),
    }).catch(() => null);
    if (res?.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Could not reassign the ticket");
    }
    setPending(false);
  }

  const unchanged = value === (currentAssigneeId === null ? "" : String(currentAssigneeId));

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        Reassign to
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        className="h-[1.875rem] min-w-0 max-w-[11rem] rounded-[var(--radius-control)] border border-ink-3 bg-panel px-1.5 text-sm text-ink hover:border-ink"
      >
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {!unchanged && (
        <button type="submit" disabled={pending} className="btn btn-sm">
          {pending ? "Saving…" : "Reassign"}
        </button>
      )}
      <span aria-live="polite" className="text-xs">
        {saved && unchanged && <span className="text-ok-ink">Reassigned</span>}
        {error && (
          <span role="alert" className="text-jet-ink">
            {error}
          </span>
        )}
      </span>
    </form>
  );
}
