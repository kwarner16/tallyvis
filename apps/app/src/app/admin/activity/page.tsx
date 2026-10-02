import { listRecentActivityAdmin } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";
import { RecentActivityFeed } from "@/components/admin/RecentActivityFeed";

export default async function AdminActivityPage() {
  const { db, session } = await requireAdminContext();
  const events = await listRecentActivityAdmin(db, session);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Activity</h1>
        <p className="text-ink-soft">
          Derived from existing signup, subscription, and quote timestamps — not a dedicated audit log yet (see
          docs/decisions/0035-admin-dashboard.md).
        </p>
      </div>
      <div className="rounded-2xl border border-line bg-paper p-5">
        <RecentActivityFeed events={events} />
      </div>
    </div>
  );
}
