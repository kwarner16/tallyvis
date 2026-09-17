import { getActiveConfiguration } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { PricingPageClient } from "@/components/dashboard/PricingPageClient";

export default async function PricingPage() {
  const { db, session } = await requireContext();
  const configuration = getActiveConfiguration(db, session);

  return <PricingPageClient initialConfiguration={configuration} />;
}
