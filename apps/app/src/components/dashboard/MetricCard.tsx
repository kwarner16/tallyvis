export function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-5">
      <p className="text-2xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
      {sublabel ? <p className="mt-2 text-xs text-ink-faint">{sublabel}</p> : null}
    </div>
  );
}
