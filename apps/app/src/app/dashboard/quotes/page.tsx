import { listQuotes } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { QuotesPageClient } from "@/components/dashboard/QuotesPageClient";

export default async function QuotesPage() {
  const { db, session } = await requireContext();
  const quotes = await listQuotes(db, session);

  return <QuotesPageClient quotes={quotes} />;
}
