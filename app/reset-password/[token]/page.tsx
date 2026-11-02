import { AuthCard } from "../../_components/auth-card";
import { JsonForm } from "../../_components/json-form";

export const metadata = { title: "Choose a new password", robots: { index: false } };

/** Public: the emailed reset link. A used or expired link is reported when the form is sent. */
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthCard title="Choose a new password" intro="This signs you out on every device. Then sign in with the new password.">
      <JsonForm
        endpoint="/api/auth/password-reset/complete"
        extra={{ token }}
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            minLength: 10,
            maxLength: 72,
            hint: "At least 10 characters.",
          },
        ]}
        submitLabel="Set new password"
        pendingLabel="Saving…"
        doneText="Your password has been changed."
        signInAfter
      />
    </AuthCard>
  );
}
