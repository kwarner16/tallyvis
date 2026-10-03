import Link from "next/link";
import { getCreatorOutreachMetricsAdmin } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export default async function AdminCreatorOutreachMetricsPage() {
  const { db, session } = await requireAdminContext();
  const metrics = await getCreatorOutreachMetricsAdmin(db, session);
  const notContacted = metrics.totalProspects - metrics.contacted;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/creators/outreach" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Creator Outreach
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Creator outreach metrics</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total prospects" value={String(metrics.totalProspects)} />
        <MetricCard label="Not contacted" value={String(notContacted)} />
        <MetricCard label="Contacted" value={String(metrics.contacted)} />
        <MetricCard label="Awaiting reply" value={String(metrics.awaitingReply)} />
        <MetricCard label="Replied" value={String(metrics.replied)} />
        <MetricCard label="Interested" value={String(metrics.interested)} />
        <MetricCard label="Not interested" value={String(metrics.notInterested)} />
        <MetricCard label="Follow-ups due" value={String(metrics.followUpsDue)} />
        <MetricCard label="Converted creators" value={String(metrics.converted)} />
        <MetricCard label="Outreach → reply rate" value={formatPercent(metrics.outreachToReplyRate)} sublabel="replied ÷ contacted" />
        <MetricCard
          label="Outreach → interested rate"
          value={formatPercent(metrics.outreachToInterestedRate)}
          sublabel="interested ÷ contacted"
        />
        <MetricCard
          label="Outreach → conversion rate"
          value={formatPercent(metrics.outreachToConversionRate)}
          sublabel="converted ÷ total prospects"
        />
      </div>

      <p className="text-xs text-ink-faint">
        &ldquo;Converted&rdquo; means a prospect was explicitly linked to a real Founding Creator record — it does not by itself mean
        that creator is active, has complimentary access, or has referred any paying customer.
      </p>
    </div>
  );
}
