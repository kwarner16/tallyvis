import Link from "next/link";
import { listSubscriptionsAdmin, type AdminSubscriptionRow } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";

/** The display bucket a subscription row belongs to on this page — distinct from the internal `status` column (see docs/decisions/0036-subscription-provider-status.md): "active" here specifically excludes anything Stripe-confirmed `past_due`, which gets its own section instead of being silently folded into "Active." */
type DisplaySection = "active" | "past_due" | "trialing" | "canceled" | "incomplete" | "expired";

const SECTIONS: { key: DisplaySection; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "past_due", label: "Past due" },
  { key: "trialing", label: "Trialing" },
  { key: "canceled", label: "Canceled" },
  { key: "incomplete", label: "Incomplete" },
  { key: "expired", label: "Expired / unpaid" },
];

function displaySection(row: AdminSubscriptionRow): DisplaySection {
  if (row.status === "active") return row.isPastDue ? "past_due" : "active";
  return row.status;
}

const PLAN_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function StatusTable({ rows }: { rows: AdminSubscriptionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">None.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Business</th>
            <th className="px-4 py-3 font-medium">Plan</th>
            <th className="px-4 py-3 font-medium">Stripe status</th>
            <th className="px-4 py-3 font-medium">Recurring value</th>
            <th className="px-4 py-3 font-medium">Trial used</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Canceled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.businessId}>
              <td className="px-4 py-3 font-medium text-ink">
                <Link href={`/admin/businesses/${row.businessId}`} className="hover:underline">
                  {row.businessName}
                </Link>
              </td>
              <td className="px-4 py-3 text-ink-soft">{PLAN_LABELS[row.planId] ?? row.planId}</td>
              <td className="px-4 py-3 text-ink-soft">{row.providerStatus ?? "Unknown (not yet synced)"}</td>
              <td className="px-4 py-3 font-mono text-ink">
                {row.mrrBucket !== "none" ? formatCents(row.recurringCents) : "—"}
                {row.mrrBucket === "past_due" ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Past due
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-ink-soft">{row.trialUsedAt ? formatDate(row.trialUsedAt) : "Never"}</td>
              <td className="px-4 py-3 text-ink-soft">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3 text-ink-soft">{formatDate(row.canceledAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminSubscriptionsPage() {
  const { db, session } = await requireAdminContext();
  const subscriptions = await listSubscriptionsAdmin(db, session);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Subscriptions</h1>
        <p className="text-ink-soft">
          {subscriptions.length} subscriptions on file. &ldquo;Past due&rdquo; subscriptions are Stripe-confirmed delinquent —
          they still have product access during Stripe&rsquo;s dunning/grace period, but their recurring value is shown
          separately from clean &ldquo;Active&rdquo; MRR, never folded into it (see
          docs/decisions/0036-subscription-provider-status.md). A row with &ldquo;Unknown (not yet synced)&rdquo; Stripe status
          hasn&rsquo;t received a webhook or reconciliation pass since this field was introduced — it&rsquo;s treated as clean
          active until Stripe says otherwise.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const rows = subscriptions.filter((row) => displaySection(row) === section.key);
        return (
          <section key={section.key} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-ink">
              {section.label} <span className="text-sm font-normal text-ink-faint">({rows.length})</span>
            </h2>
            <StatusTable rows={rows} />
          </section>
        );
      })}
    </div>
  );
}
