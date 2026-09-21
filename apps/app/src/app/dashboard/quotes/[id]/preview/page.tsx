import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { getCurrentBusiness, getQuote } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { CustomerQuoteView } from "@/components/quote/CustomerQuoteView";

/**
 * Business-side "Preview" (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md): what the customer's page
 * looks like, without needing the raw share token at all. This is a real,
 * `requireContext()`-guarded dashboard page — the same authorization every
 * other `/dashboard/*` route enforces — not the public route, so it works
 * whether or not a share link currently exists, and never exposes the
 * token. `CustomerQuoteView` is rendered without `actions`, so it's
 * read-only here; only the real public page can accept/decline/request
 * changes.
 */
export default async function QuotePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, session } = await requireContext();
  const quote = getQuote(db, session, id);

  if (!quote) {
    return (
      <EmptyState
        heading="Quote not found"
        description="This quote may have been removed."
        action={
          <Link href="/dashboard/quotes" className={buttonVariants({ variant: "outline" })}>
            Back to quotes
          </Link>
        }
      />
    );
  }

  const business = getCurrentBusiness(db, session);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between rounded-2xl border border-accent bg-accent-soft px-4 py-3">
        <p className="text-sm font-medium text-accent-strong">
          Preview — this is what {quote.customer.name || "your customer"} sees. Actions are disabled here.
        </p>
        <Link
          href={`/dashboard/quotes/${id}`}
          className="shrink-0 text-sm font-medium text-accent-strong hover:text-accent"
        >
          Back to quote
        </Link>
      </div>
      <CustomerQuoteView quote={quote} business={business} />
    </div>
  );
}
