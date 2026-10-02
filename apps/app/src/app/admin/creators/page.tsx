import Link from "next/link";
import { listCreatorsAdmin, type CreatorAdminListRow } from "@tallyvis/api";
import { formatBasisPointsAsPercent } from "@tallyvis/config";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CreatorForm } from "@/components/admin/CreatorForm";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const STATUS_LABELS: Record<CreatorAdminListRow["status"], string> = {
  prospect: "Prospect",
  invited: "Invited",
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};

const STATUS_BADGE_CLASS: Record<CreatorAdminListRow["status"], string> = {
  prospect: "bg-paper-alt text-ink-faint",
  invited: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-800",
  inactive: "bg-red-100 text-red-700",
};

export default async function AdminCreatorsPage() {
  const { db, session } = await requireAdminContext();
  const { rows, overview } = await listCreatorsAdmin(db, session);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Creators / Affiliates</h1>
        <p className="text-ink-soft">The TallyVis Founding Creator Program — referral attribution and commissions.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Active creators" value={String(overview.activeCreators)} />
        <MetricCard label="Referral clicks" value={String(overview.totalClicks)} />
        <MetricCard label="Referred signups" value={String(overview.totalSignups)} />
        <MetricCard label="Paying referred businesses" value={String(overview.totalPaying)} />
        <MetricCard label="Referred MRR" value={formatCents(overview.totalMrrCents)} />
        <MetricCard label="Commission earned" value={formatCents(overview.totalCommissionEarnedCents)} />
        <MetricCard label="Commission unpaid" value={formatCents(overview.totalCommissionUnpaidCents)} />
        <MetricCard label="Commission paid" value={formatCents(overview.totalCommissionPaidCents)} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">All creators</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">No creators yet — add the first one below.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Creator</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Platform</th>
                  <th className="px-4 py-3 font-medium">Referral code</th>
                  <th className="px-4 py-3 font-medium">Clicks</th>
                  <th className="px-4 py-3 font-medium">Signups</th>
                  <th className="px-4 py-3 font-medium">Paying</th>
                  <th className="px-4 py-3 font-medium">MRR</th>
                  <th className="px-4 py-3 font-medium">Rate</th>
                  <th className="px-4 py-3 font-medium">Earned</th>
                  <th className="px-4 py-3 font-medium">Unpaid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/admin/creators/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[row.status]}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{row.platform || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">/r/{row.slug}</td>
                    <td className="px-4 py-3 text-ink">{row.clickCount}</td>
                    <td className="px-4 py-3 text-ink">{row.signupCount}</td>
                    <td className="px-4 py-3 text-ink">{row.payingCount}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCents(row.mrrCents)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatBasisPointsAsPercent(row.commissionRateBps)}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCents(row.commissionEarnedCents)}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCents(row.commissionUnpaidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-lg font-semibold text-ink">Add a creator</h2>
        <CreatorForm />
      </section>
    </div>
  );
}
