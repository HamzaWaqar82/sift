import { requirePageUser } from "@/lib/auth";
import { JsonForm } from "../../_components/json-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

/** The signed-in user's account: change the sign-in email address. */
export default async function AccountPage() {
  const user = await requirePageUser();
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="caps-bold text-2xl text-ink">Your account</h1>
      <p className="mt-1 text-sm text-ink-2">
        {user.name}, signed in as <span className="font-medium text-ink">{user.email}</span>
      </p>
      <section className="coupon mt-6 p-6" aria-labelledby="email-heading">
        <h2 id="email-heading" className="caps-bold text-lg text-ink">
          Change email address
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          We will email a link to the new address. Your current address keeps working until you confirm it.
        </p>
        <JsonForm
          endpoint="/api/me/email"
          fields={[
            { name: "newEmail", label: "New email address", type: "email", autoComplete: "email", maxLength: 254 },
            { name: "password", label: "Current password", type: "password", autoComplete: "current-password", maxLength: 200 },
          ]}
          submitLabel="Send confirmation link"
          pendingLabel="Sending…"
          doneText="Check the new address for a confirmation link. It expires in 24 hours."
        />
      </section>
    </div>
  );
}
