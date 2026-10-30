import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getPageUser()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in to Sift</h1>
        <p className="mt-1 text-sm text-slate-600">Support team accounts only.</p>
        <SignInForm />
      </div>
    </main>
  );
}
