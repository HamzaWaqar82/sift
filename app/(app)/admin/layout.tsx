import { notFound } from "next/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

// Sections of the admin area. Add a page here (and a folder next to this file) to extend it.
const SECTIONS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
];

/** Admin area shell: non-admins get a 404 so the area does not advertise itself. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  if (!isAdmin(user)) notFound();
  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 lg:px-6">
      <h1 className="caps-bold text-2xl text-ink">Admin</h1>
      <AdminNav sections={SECTIONS} />
      {children}
    </div>
  );
}
