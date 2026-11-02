import { AuthCard } from "../_components/auth-card";
import { JsonForm } from "../_components/json-form";

export const metadata = { title: "Reset password" };

/** Public: ask for a reset link. The answer is the same whether or not the address has an account. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset password" intro="Enter your work email and we will send you a link to choose a new password.">
      <JsonForm
        endpoint="/api/auth/password-reset/request"
        fields={[{ name: "email", label: "Work email", type: "email", autoComplete: "email", maxLength: 254 }]}
        submitLabel="Send reset link"
        pendingLabel="Sending…"
      />
      <p className="mt-4 text-sm">
        <a href="/sign-in" className="text-ink-2 underline">
          Back to sign in
        </a>
      </p>
    </AuthCard>
  );
}
