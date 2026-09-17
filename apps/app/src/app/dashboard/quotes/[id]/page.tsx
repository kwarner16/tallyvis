import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { getConfigurationById, getQuote } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { QuoteDetailClient } from "@/components/dashboard/QuoteDetailClient";

export default async function QuoteDetailPage({
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

  const pricingConfiguration = getConfigurationById(db, session, quote.pricingConfigId);

  return <QuoteDetailClient initialQuote={quote} initialPricingConfiguration={pricingConfiguration} />;
}
