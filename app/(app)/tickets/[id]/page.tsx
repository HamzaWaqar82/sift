import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { parseTicketId } from "@/lib/tickets/schema";
import { DetailSkeleton } from "../../_components/skeletons";
import { TicketView } from "./ticket-view";

export const metadata = { title: "Ticket" };

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseTicketId((await params).id);
  if (id === null) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 lg:px-6">
      <Link href="/" className="btn btn-sm btn-ghost -ml-2 mb-3">
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
        All tickets
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <TicketView id={id} />
      </Suspense>
    </div>
  );
}
