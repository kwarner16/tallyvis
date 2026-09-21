import { getCurrentBusiness } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { WebsiteInstallClient } from "@/components/dashboard/WebsiteInstallClient";
import { APP_URL } from "@/lib/urls";

export default async function WebsitePage() {
  const { db, session } = await requireContext();
  const business = getCurrentBusiness(db, session);

  return <WebsiteInstallClient business={business} appOrigin={APP_URL} />;
}
