import { listQuotesWithOutcomes } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { JobOutcomesPageClient } from "@/components/dashboard/JobOutcomesPageClient";

export default async function JobOutcomesPage() {
  const { db, session } = await requireContext();
  const summaries = await listQuotesWithOutcomes(db, session);

  return <JobOutcomesPageClient summaries={summaries} />;
}
