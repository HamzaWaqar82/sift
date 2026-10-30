import Link from "next/link";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Signed-in shell: every page in this group requires a session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Sift
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-700">
              {user.name}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                  user.role === "admin" ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-700"
                }`}
              >
                {user.role === "admin" ? "Admin" : "Agent"}
              </span>
            </span>
            <form action="/api/auth/sign-out" method="post">
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
