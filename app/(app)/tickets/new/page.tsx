import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewTicketForm } from "./new-ticket-form";

export const metadata = { title: "New ticket" };

export default function NewTicketPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 lg:px-6">
      <Link href="/" className="btn btn-sm btn-ghost -ml-2 mb-3">
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
        All tickets
      </Link>
      <h1 className="caps-bold text-2xl text-ink">Log a ticket</h1>
      <p className="mb-6 mt-1 max-w-prose text-sm text-ink-2">
        For a phone call or chat. Email tickets arrive on their own through the webhook.
      </p>
      <NewTicketForm />
    </div>
  );
}
