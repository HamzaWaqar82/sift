import { AuthCard } from "../../_components/auth-card";
import { JsonForm } from "../../_components/json-form";

export const metadata = { title: "Confirm email address", robots: { index: false } };

/**
 * Public: the link emailed to a new address. Confirming takes a click (a POST), so a mail
 * scanner that follows links cannot use it up.
 */
export default async function ConfirmEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthCard
      title="Confirm email address"
      intro="Confirm to make this your Sift sign-in address. You will be signed out on every device."
    >
      <JsonForm
        endpoint="/api/email-change/confirm"
        extra={{ token }}
        fields={[]}
        submitLabel="Confirm new address"
        pendingLabel="Confirming…"
        doneText="Your email address has been changed. Sign in with the new address."
        signInAfter
      />
    </AuthCard>
  );
}
