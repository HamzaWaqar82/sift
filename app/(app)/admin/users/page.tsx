import { listUsers } from "@/lib/admin/users";
import { requirePageUser } from "@/lib/auth";
import { UserRow } from "./user-row";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePageUser();
  const users = await listUsers();
  return (
    <section aria-labelledby="users-h">
      <h2 id="users-h" className="sr-only">
        Users
      </h2>
      <div className="coupon-quiet overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead className="bg-panel-2 font-display text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th scope="col" className="px-3 py-2">User</th>
              <th scope="col" className="px-3 py-2">Role</th>
              <th scope="col" className="px-3 py-2">Availability</th>
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === me.id} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
