import { getTriage } from "@/lib/triage";
import { TriagePanelClient, type TriageViewJson } from "./triage-panel-client";

/** AI triage panel for the ticket detail page: loads the stored triage, then hands off to the client. */
export async function TriagePanel({ ticketId }: { ticketId: number }) {
  const triage = await getTriage(ticketId);
  const initial = triage ? ({ ...triage, createdAt: triage.createdAt.toISOString() } as TriageViewJson) : null;
  return <TriagePanelClient ticketId={ticketId} initial={initial} />;
}
