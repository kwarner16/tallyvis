import Link from "next/link";
import { getSalesMetricsAdmin, type SalesMetricsPeriod } from "@tallyvis/api";
import { cn } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";

const PERIODS: { value: SalesMetricsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

function isPeriod(value: string | undefined): value is SalesMetricsPeriod {
  return PERIODS.some((p) => p.value === value);
}

function formatPercent(rate: number | undefined): string {
  if (rate === undefined) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export default async function AdminSalesMetricsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { db, session } = await requireAdminContext();
  const { period: rawPeriod } = await searchParams;
  const period: SalesMetricsPeriod = isPeriod(rawPeriod) ? rawPeriod : "all";

  const metrics = await getSalesMetricsAdmin(db, session, period);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/sales" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Sales
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Sales metrics</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <Link
            key={option.value}
            href={`/admin/sales/metrics?period=${option.value}`}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              period === option.value ? "bg-ink text-paper" : "border border-line bg-paper text-ink-soft hover:border-ink",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total calls" value={String(metrics.totalCalls)} />
        <MetricCard label="Calls today" value={String(metrics.callsToday)} />
        <MetricCard label="Answered / conversations" value={String(metrics.answeredCount)} />
        <MetricCard label="No answer" value={String(metrics.noAnswerCount)} sublabel={`Voicemail: ${metrics.voicemailCount}`} />
        <MetricCard label="Interested" value={String(metrics.interestedCount)} />
        <MetricCard label="Demos" value={String(metrics.demoCount)} />
        <MetricCard label="Follow-ups" value={String(metrics.followUpCount)} />
        <MetricCard label="Signed up" value={String(metrics.signedUpCount)} />
        <MetricCard label="Call → signup rate" value={formatPercent(metrics.callToSignupRate)} />
        <MetricCard label="Conversation → signup rate" value={formatPercent(metrics.conversationToSignupRate)} />
        <MetricCard label="Avg. call duration" value={formatDuration(metrics.averageCallDurationSeconds)} />
      </div>

      <p className="text-xs text-ink-faint">
        &ldquo;Signed up&rdquo; is a manually selected call outcome only — it does not imply an active subscription, collected
        revenue, or a linked TallyVis business account.
      </p>
    </div>
  );
}
