import Link from "next/link";
import { getAdminOverview } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { GrowthChart } from "@/components/admin/GrowthChart";
import { RecentActivityFeed } from "@/components/admin/RecentActivityFeed";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function AdminOverviewPage() {
  const { db, session } = await requireAdminContext();
  const overview = await getAdminOverview(db, session);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Overview</h1>
        <p className="text-ink-soft">What&rsquo;s happening across the platform right now.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Businesses</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Total businesses" value={String(overview.businesses.total)} />
          <MetricCard label="New in last 7 days" value={String(overview.businesses.last7Days)} />
          <MetricCard label="New in last 30 days" value={String(overview.businesses.last30Days)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Subscriptions &amp; revenue</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Active MRR"
            value={formatCents(overview.mrr.activeMrrCents)}
            sublabel="Active, current subscriptions only"
          />
          <MetricCard
            label="Past-due MRR exposure"
            value={formatCents(overview.mrr.pastDueMrrCents)}
            sublabel="Billing, not yet collected — see /admin/subscriptions"
          />
          <MetricCard label="Active" value={String(overview.subscriptions.active)} />
          <MetricCard label="Past due" value={String(overview.subscriptions.pastDue)} />
          <MetricCard label="Trialing" value={String(overview.subscriptions.trialing)} />
          <MetricCard label="Canceled" value={String(overview.subscriptions.canceled)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Product usage</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Total quotes" value={String(overview.quotes.total)} />
          <MetricCard label="Quotes (7d)" value={String(overview.quotes.last7Days)} />
          <MetricCard label="Quotes (30d)" value={String(overview.quotes.last30Days)} />
          <MetricCard label="Accepted" value={String(overview.quotes.accepted)} />
          <MetricCard label="Declined" value={String(overview.quotes.declined)} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Pending / open quotes" value={String(overview.quotes.pendingOpen)} />
          <MetricCard label="Total customers" value={String(overview.totalCustomers)} />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <GrowthChart title="Businesses created (30d)" series={overview.growth.businessesByDay} />
        <GrowthChart title="Quotes generated (30d)" series={overview.growth.quotesByDay} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
          <Link href="/admin/activity" className={buttonVariants({ variant: "outline" })}>
            View all
          </Link>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-5">
          <RecentActivityFeed events={overview.recentActivity} />
        </div>
      </section>
    </div>
  );
}
