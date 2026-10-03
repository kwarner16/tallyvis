import { notFound, redirect } from "next/navigation";
import { getSalesCallDetailAdmin } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";
import { CallInProgressClient } from "@/components/admin/sales/CallInProgressClient";

export default async function AdminSalesCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, session } = await requireAdminContext();
  const { id } = await params;
  const detail = await getSalesCallDetailAdmin(db, session, id);
  if (!detail) notFound();
  // A stale link to an already-completed call — nothing left to do here.
  if (detail.call.endedAt) redirect("/admin/sales");

  return <CallInProgressClient detail={detail} />;
}
