import { listInvites } from "@/lib/invitations";
import { InvitationRow } from "./invitation-row";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  const invites = await listInvites();
  return (
    <section aria-labelledby="invites-h" className="space-y-4">
      <h2 id="invites-h" className="sr-only">
        Invitations
      </h2>
      <InviteForm />
      <div className="coupon-quiet overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead className="bg-panel-2 font-display text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th scope="col" className="px-3 py-2">Invitee</th>
              <th scope="col" className="px-3 py-2">Role</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Expires</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <InvitationRow key={i.id} invite={i} />
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                  No invitations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
