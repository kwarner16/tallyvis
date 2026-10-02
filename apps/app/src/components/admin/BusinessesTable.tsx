import Link from "next/link";
import type { AdminBusinessListRow, AdminBusinessSortBy, AdminSortDirection } from "@tallyvis/api";
import { cn } from "@tallyvis/ui";

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  canceled: "Canceled",
  expired: "Expired",
  incomplete: "Incomplete",
};

const PLAN_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };

/** "Active" specifically excludes a Stripe-confirmed past_due subscription — see docs/decisions/0036-subscription-provider-status.md. */
function describeSubscriptionStatus(row: AdminBusinessListRow): string {
  if (!row.subscriptionStatus) return "—";
  if (row.subscriptionStatus === "active" && row.providerStatus === "past_due") return "Past due";
  return STATUS_LABELS[row.subscriptionStatus] ?? row.subscriptionStatus;
}

function describeTrialStatus(row: AdminBusinessListRow): string {
  if (!row.subscriptionStatus) return "No subscription";
  if (row.subscriptionStatus === "trialing") return "Trialing";
  if (row.trialUsedAt) return "Trial used";
  return "Never trialed";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface SortLinkProps {
  label: string;
  sortBy: AdminBusinessSortBy;
  currentSortBy: AdminBusinessSortBy;
  currentSortDirection: AdminSortDirection;
  search: string;
}

/** A column header that's also the sort control — toggling direction when it's already the active column, defaulting to descending otherwise (newest/highest first, the generally more useful default for every sortable column here). */
function SortLink({ label, sortBy, currentSortBy, currentSortDirection, search }: SortLinkProps) {
  const isActive = sortBy === currentSortBy;
  const nextDirection: AdminSortDirection = isActive && currentSortDirection === "desc" ? "asc" : "desc";
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  params.set("sort", sortBy);
  params.set("dir", nextDirection);

  return (
    <Link href={`/admin/businesses?${params.toString()}`} className={cn("inline-flex items-center gap-1", isActive && "text-ink")}>
      {label}
      {isActive ? <span aria-hidden="true">{currentSortDirection === "desc" ? "↓" : "↑"}</span> : null}
    </Link>
  );
}

export function BusinessesTable({
  rows,
  search,
  sortBy,
  sortDirection,
}: {
  rows: AdminBusinessListRow[];
  search: string;
  sortBy: AdminBusinessSortBy;
  sortDirection: AdminSortDirection;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-8 text-center text-sm text-ink-soft">
        {search ? "No businesses match this search." : "No businesses yet."}
      </div>
    );
  }

  const sortProps = { currentSortBy: sortBy, currentSortDirection: sortDirection, search };

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
      <table className="w-full min-w-[840px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-3">
              <SortLink label="Business" sortBy="name" {...sortProps} />
            </th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Trial</th>
            <th className="px-4 py-3">
              <SortLink label="Quotes" sortBy="quoteCount" {...sortProps} />
            </th>
            <th className="px-4 py-3">Customers</th>
            <th className="px-4 py-3">
              <SortLink label="Signed up" sortBy="createdAt" {...sortProps} />
            </th>
            <th className="px-4 py-3">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-paper-alt">
              <td className="px-4 py-3 font-medium text-ink">
                <Link href={`/admin/businesses/${row.id}`} className="hover:underline">
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-ink-soft">{row.ownerEmail ?? "—"}</td>
              <td className="px-4 py-3 text-ink-soft">{row.planId ? PLAN_LABELS[row.planId] ?? row.planId : "—"}</td>
              <td className="px-4 py-3 text-ink-soft">{describeSubscriptionStatus(row)}</td>
              <td className="px-4 py-3 text-ink-soft">{describeTrialStatus(row)}</td>
              <td className="px-4 py-3 text-ink-soft">{row.quoteCount}</td>
              <td className="px-4 py-3 text-ink-soft">{row.customerCount}</td>
              <td className="px-4 py-3 text-ink-soft">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3 text-ink-soft">{formatDate(row.lastQuoteAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
