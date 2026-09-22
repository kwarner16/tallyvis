import { getActiveConfiguration } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { NewQuoteClient } from "@/components/dashboard/NewQuoteClient";

export default async function NewQuotePage() {
  const { db, session } = await requireContext();
  const configuration = await getActiveConfiguration(db, session);

  return <NewQuoteClient configuration={configuration} />;
}
