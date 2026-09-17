import type { ReactNode } from "react";
import { getCurrentBusiness } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { db, session } = await requireContext();
  const business = getCurrentBusiness(db, session);

  return <DashboardShell businessName={business.name}>{children}</DashboardShell>;
}
