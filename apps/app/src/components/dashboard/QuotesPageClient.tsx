"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Quote, QuoteStatus } from "@tallyvis/types";
import { buttonVariants, cn } from "@tallyvis/ui";
import { QUOTE_FILTERS } from "@/lib/quoteStatusCopy";
import { QuoteList } from "@/components/dashboard/QuoteList";
import { EmptyState } from "@/components/dashboard/EmptyState";

/** Receives the business's quotes already loaded server-side (see dashboard/quotes/page.tsx) — this component only handles client-side filter/search interactivity, not data access. */
export function QuotesPageClient({ quotes }: { quotes: Quote[] }) {
  const [filter, setFilter] = useState<QuoteStatus | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return quotes.filter((q) => {
      const matchesStatus = filter === "all" || q.status === filter;
      const query = search.trim().toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        q.customer.name.toLowerCase().includes(query) ||
        (q.property.address ?? "").toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [quotes, filter, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Quotes</h1>
          <p className="text-ink-soft">Every estimate Tallyvis has generated for your business.</p>
        </div>
        <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "primary" })}>
          New quote
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {QUOTE_FILTERS.map((option) => (
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
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or address"
          className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong sm:w-64"
        />
      </div>

      {filtered.length > 0 ? (
        <QuoteList quotes={filtered} />
      ) : (
        <EmptyState
          heading={quotes.length === 0 ? "No quotes yet." : "No quotes match this filter."}
          description={
            quotes.length === 0
              ? "Quotes submitted through the customer estimator will show up here — or create one yourself."
              : "Try a different status filter or search term."
          }
          action={
            quotes.length === 0 ? (
              <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "primary" })}>
                New quote
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
