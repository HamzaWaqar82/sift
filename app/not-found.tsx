import Link from "next/link";
import { VoidCoupon } from "./_components/void-coupon";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="h-2 bg-ink" aria-hidden="true" />
      <VoidCoupon
        code="Not found"
        title="No ticket at this address"
        actions={
          <Link href="/" className="btn btn-navy">
            Back to the inbox
          </Link>
        }
      >
        <p>The ticket or page may have been mistyped, or the link is from somewhere else. Search the inbox for the customer or subject instead.</p>
      </VoidCoupon>
    </main>
  );
}
