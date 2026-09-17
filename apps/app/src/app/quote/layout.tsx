import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the customer-facing /quote/[id] view — just the
 * wordmark, no dashboard nav or estimator step progress. Kept separate from
 * `DashboardShell` on purpose: nothing rendered under this layout should
 * ever require a business to be signed in (there's no auth system yet
 * either way — see docs/decisions/0010-quote-creation-and-customer-view.md
 * for the access-control limitation this implies).
 */
export default function QuoteViewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8 sm:px-6 sm:py-14">
      <header className="mb-8 sm:mb-10">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold text-ink">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Tallyvis
        </Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
