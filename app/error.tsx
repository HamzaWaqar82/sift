"use client";

import Link from "next/link";
import { VoidCoupon } from "./_components/void-coupon";

/** Error boundary for every page: the work is safe, the view failed. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col">
      <VoidCoupon
        code="Error"
        title="This view failed to load"
        actions={
          <>
            <button type="button" onClick={reset} className="btn btn-navy">
              Try again
            </button>
            <Link href="/" className="btn">
              Back to the inbox
            </Link>
          </>
        }
      >
        <p>Nothing you sent was lost: replies are saved the moment you send them. Try again, and if it keeps failing, tell your admin.</p>
        {error.digest && (
          <p className="mt-3 text-sm">
            Reference <span className="num">{error.digest}</span>
          </p>
        )}
      </VoidCoupon>
    </main>
  );
}
