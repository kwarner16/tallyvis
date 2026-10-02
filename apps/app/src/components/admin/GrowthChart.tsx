import { cn } from "@tallyvis/ui";

/**
 * A deliberately tiny, dependency-free bar chart (see
 * docs/decisions/0035-admin-dashboard.md's "Growth Visualization"
 * section) — no charting library exists anywhere in this repo yet, and a
 * 30-point daily series doesn't justify adding one. Pure CSS bars scaled
 * to the series' own max value; the exact count is in each bar's `title`
 * tooltip rather than drawn on the chart, to stay legible at 30 points
 * wide on a phone screen.
 */
export function GrowthChart({
  title,
  series,
}: {
  title: string;
  series: { date: string; count: number }[];
}) {
  const max = Math.max(1, ...series.map((point) => point.count));
  const total = series.reduce((sum, point) => sum + point.count, 0);

  return (
    <div className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-faint">{total} in {series.length} days</p>
      </div>
      <div className="mt-4 flex h-28 items-end gap-[2px]" role="img" aria-label={`${title}: ${total} over the last ${series.length} days`}>
        {series.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${point.count}`}
            className={cn("flex-1 rounded-t-sm bg-accent/80", point.count === 0 && "bg-line")}
            style={{ height: `${point.count === 0 ? 2 : Math.max(4, (point.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-faint">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}
