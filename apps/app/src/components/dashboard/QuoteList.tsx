import Link from "next/link";
import type { Quote } from "@tallyvis/types";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { QuoteStatusBadge } from "./QuoteStatusBadge";

function formatEstimate(quote: Quote): string {
  const display = getEstimateDisplay(quote.estimate);
  return display.kind === "exact"
    ? `$${display.amount.toFixed(0)}`
    : `$${display.low}–$${display.high}`;
}

function formatCreatedAt(iso: string): string {
  const created = new Date(iso);
  const now = new Date();
  const sameDay = created.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (created.toDateString() === yesterday.toDateString()) return "Yesterday";
  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function propertyLabel(quote: Quote): string {
  const stories = quote.property.stories >= 3 ? "3+" : String(quote.property.stories);
  return `${stories}-story home`;
}

export function QuoteList({ quotes }: { quotes: Quote[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      {/* Desktop / tablet: table */}
      <table className="hidden w-full text-left text-sm lg:table">
        <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Property</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Estimate</th>
            <th className="px-4 py-3 font-medium">Confidence</th>
            <th className="px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-paper">
          {quotes.map((quote) => (
            <tr key={quote.id} className="transition-colors hover:bg-paper-alt">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/quotes/${quote.id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {quote.customer.name || "Unnamed customer"}
                </Link>
              </td>
              <td className="px-4 py-3 text-ink-soft">{propertyLabel(quote)}</td>
              <td className="px-4 py-3">
                <QuoteStatusBadge status={quote.status} />
              </td>
              <td className="px-4 py-3 font-mono text-ink">{formatEstimate(quote)}</td>
              <td className="px-4 py-3">
                <ConfidenceBadge confidence={quote.analysis.metadata.confidence} />
              </td>
              <td className="px-4 py-3 text-ink-faint">{formatCreatedAt(quote.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: cards */}
      <ul className="divide-y divide-line bg-paper lg:hidden">
        {quotes.map((quote) => (
          <li key={quote.id}>
            <Link
              href={`/dashboard/quotes/${quote.id}`}
              className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-paper-alt"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {quote.customer.name || "Unnamed customer"}
                </span>
                <QuoteStatusBadge status={quote.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-soft">{propertyLabel(quote)}</span>
                <span className="font-mono text-ink">{formatEstimate(quote)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <ConfidenceBadge confidence={quote.analysis.metadata.confidence} />
                <span className="text-xs text-ink-faint">{formatCreatedAt(quote.createdAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
