import { findPendingInvite, INVITE_INVALID_MESSAGE } from "@/lib/invitations";
import { Wordmark } from "../../_components/logo";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join Sift", robots: { index: false } };

/** Public: the invitee's landing page. A bad link shows one message, whatever the reason. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findPendingInvite(token);

  return (
    <main className="flex min-h-screen flex-col">
      <div className="band h-2 bg-ink" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="coupon w-full max-w-md p-6 md:p-8">
          <Wordmark size="lg" />
          {invite ? (
            <>
              <h1 className="caps-bold mt-5 text-2xl text-ink">Join Sift</h1>
              <p className="mt-1 text-sm text-ink-2">
                Set your name and password to join as {invite.role === "admin" ? "an admin" : "an agent"}. You will be
                signed in straight away.
              </p>
              <AcceptForm token={token} />
            </>
          ) : (
            <>
              <h1 className="caps-bold mt-5 text-2xl text-ink">Link not valid</h1>
              <p role="alert" className="mt-1 text-sm text-ink-2">
                {INVITE_INVALID_MESSAGE}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
