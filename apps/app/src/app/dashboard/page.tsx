"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Quote } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { listQuotes } from "@/lib/quotes/store";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { QuoteList } from "@/components/dashboard/QuoteList";
import { EmptyState } from "@/components/dashboard/EmptyState";

const ACTIVE_STATUSES: Quote["status"][] = [
  "new",
  "needs_review",
  "more_information",
  "approved",
  "sent",
];

export default function DashboardHomePage() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);

  useEffect(() => {
    queueMicrotask(() => setQuotes(listQuotes()));
  }, []);

  if (quotes === null) return null;

  const newCount = quotes.filter((q) => q.status === "new").length;
  const needsReviewCount = quotes.filter((q) => q.status === "needs_review").length;
  const sentCount = quotes.filter((q) => q.status === "sent").length;
  const acceptedCount = quotes.filter((q) => q.status === "accepted").length;
  const pipelineTotal = quotes
    .filter((q) => ACTIVE_STATUSES.includes(q.status))
    .reduce((sum, q) => sum + q.estimate.total, 0);

  const recentQuotes = quotes.slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Good morning.
        </h1>
        <p className="text-ink-soft">Here&rsquo;s what&rsquo;s happening with your quotes.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="New quotes" value={String(newCount)} />
        <MetricCard label="Needs review" value={String(needsReviewCount)} />
        <MetricCard label="Quotes sent" value={String(sentCount)} />
        <MetricCard label="Accepted" value={String(acceptedCount)} />
        <MetricCard
          label="Estimated pipeline"
          value={`$${pipelineTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
      </div>
      <p className="-mt-6 text-xs text-ink-faint">
        Demo data for this prototype — not real Tallyvis customer metrics.
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent quotes</h2>
          <Link href="/dashboard/quotes" className={buttonVariants({ variant: "outline" })}>
            View all
          </Link>
        </div>
        {recentQuotes.length > 0 ? (
          <QuoteList quotes={recentQuotes} />
        ) : (
          <EmptyState
            heading="No quotes yet."
            description="Quotes submitted through the estimator will show up here."
          />
        )}
      </div>
    </div>
  );
}
