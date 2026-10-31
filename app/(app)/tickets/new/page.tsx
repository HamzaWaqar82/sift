import Link from "next/link";
import { NewTicketForm } from "./new-ticket-form";

export default function NewTicketPage() {
  return (
    <div className="max-w-2xl">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← All tickets
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">New ticket</h1>
      <p className="mt-1 text-sm text-slate-600">Log a phone call or chat. The ticket is marked with source “Form”.</p>
      <NewTicketForm />
    </div>
  );
}
