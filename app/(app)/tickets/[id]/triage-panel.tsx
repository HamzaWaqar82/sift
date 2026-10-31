import { getPageUser } from "@/lib/auth";
import { getTriage } from "@/lib/triage";
import { TriagePanelClient, type TriageViewJson } from "./triage-panel-client";

/** AI triage panel for the ticket detail page: loads the stored triage, then hands off to the client. */
export async function TriagePanel({ ticketId }: { ticketId: number }) {
  const [triage, user] = await Promise.all([getTriage(ticketId), getPageUser()]);
  const initial = triage ? ({ ...triage, createdAt: triage.createdAt.toISOString() } as TriageViewJson) : null;
  // Regenerate is admin only; the API also refuses agents (403).
  return <TriagePanelClient ticketId={ticketId} initial={initial} canRegenerate={user?.role === "admin"} />;
}
