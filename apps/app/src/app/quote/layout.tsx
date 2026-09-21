import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the customer-facing /quote/[token] view — just the
 * wordmark, no dashboard nav or estimator step progress. Kept separate from
 * `DashboardShell` on purpose: nothing rendered under this layout should
 * ever require a business to be signed in — a customer never has an
 * account here. Since Phase 10, the dynamic segment is a share token, not
 * the quote's own database id: possession of it is the actual access
 * credential, not an incidental byproduct of an unguessable id. See
 * docs/decisions/0012-secure-quote-sharing.md, which supersedes the
 * access-control limitation ADR 0010 originally recorded here.
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
