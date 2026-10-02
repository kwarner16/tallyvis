import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCreatorDetailAdmin, type CreatorStatus } from "@tallyvis/api";
import { formatBasisPointsAsPercent } from "@tallyvis/config";
import { buttonVariants } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MARKETING_URL } from "@/lib/urls";
import { CreatorForm } from "@/components/admin/CreatorForm";
import { CopyReferralUrl } from "@/components/admin/CopyReferralUrl";
import { LinkBusinessForm } from "@/components/admin/LinkBusinessForm";
import {
  setCreatorStatusAction,
  unlinkCreatorBusinessAction,
  setComplimentaryAccessAction,
  markCommissionPaidAction,
} from "@/lib/creatorAdminActions";

const PLAN_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };
const STATUS_LABELS: Record<CreatorStatus, string> = {
  prospect: "Prospect",
  invited: "Invited",
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

export default async function AdminCreatorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, session } = await requireAdminContext();
  const { id } = await params;
  const detail = await getCreatorDetailAdmin(db, session, id);
  if (!detail) notFound();

  const { creator, referrals, commissions } = detail;
  const referralUrl = `${MARKETING_URL}/r/${creator.slug}`;
  const accrued = commissions.filter((c) => c.status === "accrued");
  const settled = commissions.filter((c) => c.status !== "accrued");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/creators" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Creators
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{creator.name}</h1>
      </div>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Referral URL</h2>
        <div className="mt-3">
          <CopyReferralUrl url={referralUrl} />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper p-5">
        <span className="text-sm font-medium text-ink">Status: {STATUS_LABELS[creator.status]}</span>
        <div className="flex flex-wrap gap-2">
          {(["active", "paused", "inactive", "invited"] as CreatorStatus[])
            .filter((status) => status !== creator.status)
            .map((status) => (
              <form key={status} action={setCreatorStatusAction}>
                <input type="hidden" name="creatorId" value={creator.id} />
                <input type="hidden" name="status" value={status} />
                <button type="submit" className={buttonVariants({ variant: "outline" })}>
                  {status === "active" ? "Activate" : status === "paused" ? "Pause" : status === "inactive" ? "Deactivate" : "Mark invited"}
                </button>
              </form>
            ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Creator information</h2>
        <CreatorForm creator={creator} />
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Free TallyVis access (founding creator)</h2>
        <p className="mt-2 text-sm text-ink-soft">
          For a creator who also operates their own TallyVis business — see docs/decisions/0040 for why this is a plain grant,
          never a fabricated Stripe subscription.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {creator.businessId ? (
            <>
              <Row label="Linked business ID" value={<code className="text-xs">{creator.businessId}</code>} />
              <div className="flex flex-wrap items-center gap-3">
                <form action={setComplimentaryAccessAction}>
                  <input type="hidden" name="creatorId" value={creator.id} />
                  <input type="hidden" name="enabled" value={creator.complimentaryAccess ? "false" : "true"} />
                  <button type="submit" className={buttonVariants({ variant: creator.complimentaryAccess ? "outline" : "primary" })}>
                    {creator.complimentaryAccess ? "Revoke complimentary access" : "Grant complimentary access"}
                  </button>
                </form>
                <form action={unlinkCreatorBusinessAction}>
                  <input type="hidden" name="creatorId" value={creator.id} />
                  <button type="submit" className={buttonVariants({ variant: "outline" })}>
                    Unlink business
                  </button>
                </form>
              </div>
              {creator.complimentaryAccess ? (
                <p className="text-sm font-medium text-green-700">This business currently has free TallyVis access.</p>
              ) : null}
            </>
          ) : (
            <LinkBusinessForm creatorId={creator.id} />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Referred businesses ({referrals.length})</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-ink-soft">No referred signups yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Signed up</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Subscription status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {referrals.map((referral) => (
                  <tr key={referral.businessId}>
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/admin/businesses/${referral.businessId}`} className="hover:underline">
                        {referral.businessName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(referral.signedUpAt)}</td>
                    <td className="px-4 py-3 text-ink-soft">{referral.planId ? PLAN_LABELS[referral.planId] ?? referral.planId : "—"}</td>
                    <td className="px-4 py-3 text-ink-soft">{referral.subscriptionStatus ?? "No subscription yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Unpaid commissions ({accrued.length})</h2>
        {accrued.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing owed right now.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Collected</th>
                  <th className="px-4 py-3 font-medium">Rate</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Mark paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accrued.map((commission) => (
                  <tr key={commission.id}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">{commission.stripeInvoiceId}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCents(commission.collectedAmountCents)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatBasisPointsAsPercent(commission.commissionRateBps)}</td>
                    <td className="px-4 py-3 font-mono font-medium text-ink">{formatCents(commission.commissionAmountCents)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(commission.createdAt)}</td>
                    <td className="px-4 py-3">
                      <form action={markCommissionPaidAction} className="flex items-center gap-2">
                        <input type="hidden" name="creatorId" value={creator.id} />
                        <input type="hidden" name="commissionId" value={commission.id} />
                        <input
                          type="text"
                          name="payoutNote"
                          placeholder="Payout note (optional)"
                          className="w-36 rounded-lg border border-line bg-paper px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
                        />
                        <button type="submit" className={buttonVariants({ variant: "primary", className: "px-3 py-1 text-xs" })}>
                          Mark paid
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {settled.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Commission history</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Settled</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {settled.map((commission) => (
                  <tr key={commission.id}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">{commission.stripeInvoiceId}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCents(commission.commissionAmountCents)}</td>
                    <td className="px-4 py-3 text-ink-soft">{commission.status === "paid" ? "Paid" : "Reversed (refunded)"}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(commission.paidAt ?? commission.reversedAt)}</td>
                    <td className="px-4 py-3 text-ink-soft">{commission.payoutNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
