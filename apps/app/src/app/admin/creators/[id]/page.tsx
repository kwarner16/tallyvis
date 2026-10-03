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
import { RecordActivityForm } from "@/components/admin/RecordActivityForm";
import {
  setCreatorStatusAction,
  unlinkCreatorBusinessAction,
  setComplimentaryAccessAction,
  markCommissionPaidAction,
} from "@/lib/creatorAdminActions";
import { isCommissionPayable } from "@tallyvis/api";

const PLAN_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };
const STATUS_LABELS: Record<CreatorStatus, string> = {
  prospect: "Prospect",
  invited: "Invited",
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

  const { creator, referrals, commissions, adjustments, financials, firstActivityMonthRequiredFrom } = detail;
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Active Creator status</h2>
        <p className="mt-2 text-sm text-ink-soft">
          At least one qualifying piece of original TallyVis content per calendar month — no minimum views/followers. TallyVis does
          not automatically verify this; Kyle records it manually after checking.
        </p>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <Row label="Activated" value={formatDateTime(creator.activatedAt)} />
          <Row
            label="Content requirement begins"
            value={
              firstActivityMonthRequiredFrom
                ? `${formatDateTime(firstActivityMonthRequiredFrom)} (the activation month itself is an onboarding month)`
                : "—"
            }
          />
          <Row label="Last recorded qualifying content" value={formatDateTime(creator.lastQualifyingContentAt)} />
          <Row
            label="Content link"
            value={
              creator.lastQualifyingContentUrl ? (
                <a href={creator.lastQualifyingContentUrl} target="_blank" rel="noreferrer" className="underline">
                  {creator.lastQualifyingContentUrl}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row label="Note" value={creator.lastQualifyingContentNote || "—"} />
        </dl>
        <div className="mt-4">
          <RecordActivityForm creatorId={creator.id} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Commission summary</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Row label="Pending" value={formatCents(financials.pendingCommissionCents)} />
          <Row label="Payable" value={formatCents(financials.payableCommissionCents)} />
          <Row label="Paid" value={formatCents(financials.paidCommissionCents)} />
          <Row label="Adjustments" value={formatCents(financials.adjustmentCents)} />
        </dl>
        <p className="mt-2 text-xs text-ink-faint">
          &ldquo;Payable&rdquo; has cleared the {`30`}-day holding period; &ldquo;pending&rdquo; has not yet. Adjustments are negative
          entries netted against a future payout when a refund arrives after a commission was already marked paid.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Complimentary TallyVis Access</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Link this creator to their TallyVis business to give them complimentary access while they&rsquo;re an active
          Founding Creator. This does not create a Stripe subscription or affect MRR.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {creator.businessId ? (
            <>
              <Row
                label="Linked business"
                value={
                  <Link href={`/admin/businesses/${creator.businessId}`} className="font-mono text-xs underline">
                    {creator.businessId}
                  </Link>
                }
              />
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
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Collected</th>
                  <th className="px-4 py-3 font-medium">Rate</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Net of reversal</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Mark paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accrued.map((commission) => {
                  const netCents = commission.commissionAmountCents - commission.reversedCommissionCents;
                  const payable = isCommissionPayable(commission);
                  return (
                    <tr key={commission.id}>
                      <td className="px-4 py-3 font-mono text-xs text-ink-soft">{commission.stripeInvoiceId}</td>
                      <td className="px-4 py-3 font-mono text-ink">{formatCents(commission.collectedAmountCents)}</td>
                      <td className="px-4 py-3 text-ink-soft">{formatBasisPointsAsPercent(commission.commissionRateBps)}</td>
                      <td className="px-4 py-3 font-mono text-ink">{formatCents(commission.commissionAmountCents)}</td>
                      <td className="px-4 py-3 font-mono font-medium text-ink">
                        {formatCents(netCents)}
                        {commission.reversedCommissionCents > 0 ? (
                          <span className="ml-1 text-xs text-ink-faint">(partially refunded)</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            payable ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {payable ? "Payable" : "Pending"}
                        </span>
                      </td>
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
                  );
                })}
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

      {adjustments.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Adjustments ({adjustments.length})</h2>
          <p className="text-sm text-ink-soft">
            Recorded only when a refund arrives after a commission was already marked paid — never rewrites the historical payout,
            instead nets against this creator&apos;s next payout.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Recorded</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td className="px-4 py-3 font-mono font-medium text-ink">{formatCents(adjustment.amountCents)}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {adjustment.reason === "refund_after_payout" ? "Refund after payout" : "Manual"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(adjustment.createdAt)}</td>
                    <td className="px-4 py-3 text-ink-soft">{adjustment.note || "—"}</td>
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
