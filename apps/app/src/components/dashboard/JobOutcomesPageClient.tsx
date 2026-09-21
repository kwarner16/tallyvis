"use client";

import { useMemo, useState } from "react";
import type { QuoteWithOutcomeSummary } from "@tallyvis/api";
import { cn } from "@tallyvis/ui";
import { JobOutcomesList } from "@/components/dashboard/JobOutcomesList";
import { EmptyState } from "@/components/dashboard/EmptyState";

type OutcomeFilter = "all" | "not_recorded" | "in_progress" | "completed";

const FILTERS: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not_recorded", label: "Not recorded" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

function outcomeFilterValue(summary: QuoteWithOutcomeSummary): OutcomeFilter {
  return summary.outcome?.status ?? "not_recorded";
}

/**
 * Phase 13 — a lightweight review view for real-world job outcomes, not a
 * full analytics dashboard (see docs/decisions/0015-job-outcome-tracking.md).
 * Lists every quote so a business can see at a glance what still needs an
 * outcome recorded, not only what's already done — data is loaded
 * server-side (see dashboard/job-outcomes/page.tsx).
 */
export function JobOutcomesPageClient({ summaries }: { summaries: QuoteWithOutcomeSummary[] }) {
  const [filter, setFilter] = useState<OutcomeFilter>("all");

  const filtered = useMemo(
    () => summaries.filter((s) => filter === "all" || outcomeFilterValue(s) === filter),
    [summaries, filter],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Job outcomes</h1>
        <p className="text-ink-soft">
          What actually happened on completed jobs, compared to the original estimate — data for later
          review, not a prediction of anything.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === option.value
                ? "border-accent-strong bg-accent-strong text-paper"
                : "border-line bg-paper text-ink-soft hover:border-ink-faint",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <JobOutcomesList summaries={filtered} />
      ) : (
        <EmptyState
          heading={summaries.length === 0 ? "No quotes yet." : "No quotes match this filter."}
          description={
            summaries.length === 0
              ? "Once you have quotes, you can record what actually happened on each job here."
              : "Try a different filter."
          }
        />
      )}
    </div>
  );
}
