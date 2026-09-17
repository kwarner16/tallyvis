import type { ReactNode } from "react";

export function EmptyState({
  heading,
  description,
  action,
}: {
  heading: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-paper-alt px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{heading}</p>
      {description ? <p className="max-w-sm text-sm text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
