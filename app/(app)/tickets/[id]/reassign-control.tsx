import { getPageUser, isAdmin } from "@/lib/auth";
import { listAssignableUsers, type Assignee } from "@/lib/tickets";
import { ReassignForm } from "./reassign-form";

/** Admin-only reassign control. Renders nothing for agents; the API also refuses them (403). */
export async function ReassignControl({ ticketId, assignee }: { ticketId: number; assignee: Assignee }) {
  const user = await getPageUser();
  if (!isAdmin(user)) return null;
  const users = await listAssignableUsers();
  return <ReassignForm ticketId={ticketId} currentAssigneeId={assignee?.id ?? null} users={users} />;
}
