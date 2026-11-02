import { Wordmark } from "./logo";

/** The signed-out page shell (navy band, centred coupon) shared by reset and confirmation pages. */
export function AuthCard({ title, intro, children }: { title: string; intro?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="band h-2 bg-ink" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="coupon w-full max-w-md p-6 md:p-8">
          <Wordmark size="lg" />
          <h1 className="caps-bold mt-5 text-2xl text-ink">{title}</h1>
          {intro && <p className="mt-1 text-sm text-ink-2">{intro}</p>}
          {children}
        </div>
      </div>
    </main>
  );
}

