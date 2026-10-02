import type { ReactNode } from "react";
import { getCurrentUser } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";
import { AdminShell } from "@/components/admin/AdminShell";

/** Every /admin/* route is authenticated, admin-only, and reads live cross-tenant data — never prerendered. Same reasoning as dashboard/layout.tsx's own comment. */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { db, session } = await requireAdminContext();
  const user = await getCurrentUser(db, session);

  return <AdminShell adminEmail={user.email}>{children}</AdminShell>;
}
