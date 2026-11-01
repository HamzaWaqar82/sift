import type { TicketListItem } from "@/lib/tickets";

/** A list item with dates as ISO strings, safe to hand to a client component. */
export type TicketCard = Omit<TicketListItem, "createdAt" | "updatedAt" | "overdueWaitingSince"> & {
  createdAt: string;
  updatedAt: string;
  overdueWaitingSince: string | null;
};

export function toCard(t: TicketListItem): TicketCard {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    overdueWaitingSince: t.overdueWaitingSince?.toISOString() ?? null,
  };
}
