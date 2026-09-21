import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the customer-facing /quote/[id] view — just the
 * wordmark, no dashboard nav or estimator step progress. Kept separate from
 * `DashboardShell` on purpose: nothing rendered under this layout should
 * ever require a business to be signed in. Phase 9 added real accounts, but
 * this route is deliberately outside them — the quote id is still an
 * unguessable-but-unauthenticated token, a limitation recorded in
 * docs/decisions/0010-quote-creation-and-customer-view.md and
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md.
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
