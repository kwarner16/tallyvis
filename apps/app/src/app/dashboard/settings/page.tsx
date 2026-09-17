import { getCurrentBusiness } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { SettingsPageClient } from "@/components/dashboard/SettingsPageClient";

export default async function SettingsPage() {
  const { db, session } = await requireContext();
  const business = getCurrentBusiness(db, session);

  return <SettingsPageClient initialBusiness={business} />;
}
