"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type User = { id: number; name: string; email: string };

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
  const [value, setValue] = useState(currentAssigneeId === null ? "" : String(currentAssigneeId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigneeId: value === "" ? null : Number(value) }),
    }).catch(() => null);
    if (res?.ok) {
      router.refresh();
    } else {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Could not reassign the ticket");
    }
    setPending(false);
  }

  const unchanged = value === (currentAssigneeId === null ? "" : String(currentAssigneeId));

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="assignee" className="text-slate-600">
        Reassign to
      </label>
      <select
        id="assignee"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-800"
      >
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || unchanged}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save"}
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
