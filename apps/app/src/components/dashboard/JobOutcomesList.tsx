import Link from "next/link";
import type { QuoteWithOutcomeSummary } from "@tallyvis/api";
import { getEstimateDisplay } from "@/lib/estimateDisplay";

function formatEstimate(summary: QuoteWithOutcomeSummary): string {
  const display = getEstimateDisplay(summary.quote.estimate);
  return display.kind === "exact" ? `$${display.amount.toFixed(0)}` : `$${display.low}–$${display.high}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(summary: QuoteWithOutcomeSummary): string {
  if (!summary.outcome) return "Not recorded";
  return summary.outcome.status === "completed" ? "Completed" : "In progress";
}

function statusClassName(summary: QuoteWithOutcomeSummary): string {
  if (!summary.outcome) return "bg-paper-alt text-ink-faint";
  return summary.outcome.status === "completed" ? "bg-accent-soft text-accent-strong" : "bg-paper-alt text-ink-soft";
}

function aiLabel(summary: QuoteWithOutcomeSummary): string {
  if (!summary.aiUsed) return "—";
  return summary.aiCorrected ? "Yes (corrected)" : "Yes";
}

/** Mirrors `QuoteList`'s table/card layout so the two lists feel like the same product, not a bolted-on separate tool. */
export function JobOutcomesList({ summaries }: { summaries: QuoteWithOutcomeSummary[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      {/* Desktop / tablet: table */}
      <table className="hidden w-full text-left text-sm lg:table">
        <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Estimate</th>
            <th className="px-4 py-3 font-medium">Actual labor</th>
            <th className="px-4 py-3 font-medium">Actual price</th>
            <th className="px-4 py-3 font-medium">AI used</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-paper">
          {summaries.map((summary) => (
            <tr key={summary.quote.id} className="transition-colors hover:bg-paper-alt">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/quotes/${summary.quote.id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {summary.quote.customer.name || "Unnamed customer"}
                </Link>
              </td>
              <td className="px-4 py-3 text-ink-faint">{formatDate(summary.quote.createdAt)}</td>
              <td className="px-4 py-3 font-mono text-ink">{formatEstimate(summary)}</td>
              <td className="px-4 py-3 text-ink-soft">
                {summary.outcome?.actualLaborMinutes !== undefined ? `${summary.outcome.actualLaborMinutes}m` : "—"}
              </td>
              <td className="px-4 py-3 text-ink-soft">
                {summary.outcome?.actualPrice !== undefined ? `$${summary.outcome.actualPrice.toFixed(2)}` : "—"}
              </td>
              <td className="px-4 py-3 text-ink-soft">{aiLabel(summary)}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName(summary)}`}>
                  {statusLabel(summary)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: cards */}
      <ul className="divide-y divide-line bg-paper lg:hidden">
        {summaries.map((summary) => (
          <li key={summary.quote.id}>
            <Link
              href={`/dashboard/quotes/${summary.quote.id}`}
              className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-paper-alt"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{summary.quote.customer.name || "Unnamed customer"}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName(summary)}`}>
                  {statusLabel(summary)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-soft">{formatDate(summary.quote.createdAt)}</span>
                <span className="font-mono text-ink">{formatEstimate(summary)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-ink-faint">
                <span>
                  {summary.outcome?.actualPrice !== undefined ? `Actual $${summary.outcome.actualPrice.toFixed(2)}` : "No actual price yet"}
                </span>
                <span>AI: {aiLabel(summary)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
