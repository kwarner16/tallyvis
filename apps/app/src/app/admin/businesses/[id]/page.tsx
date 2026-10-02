import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Quote } from "@tallyvis/types";
import { getBusinessDetailAdmin } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { QuoteStatusBadge } from "@/components/dashboard/QuoteStatusBadge";
import { getEstimateDisplay } from "@/lib/estimateDisplay";

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  canceled: "Canceled",
  expired: "Expired",
  incomplete: "Incomplete",
};

const PLAN_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };

/** "Active" specifically excludes a Stripe-confirmed past_due subscription — see docs/decisions/0036-subscription-provider-status.md. */
function describeSubscriptionStatus(status: string, providerStatus: string | undefined): string {
  if (status === "active" && providerStatus === "past_due") return "Past due";
  return STATUS_LABELS[status] ?? status;
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatEstimate(quote: Quote): string {
  const display = getEstimateDisplay(quote.estimate);
  return display.kind === "exact" ? `$${display.amount.toFixed(0)}` : `$${display.low}–$${display.high}`;
}

/**
 * The one admin page that reads a caller-supplied id directly out of the
 * URL rather than a validated session — deliberately safe BECAUSE
 * `requireAdminContext()` runs first (same trust model
 * `resolveEmbedBusiness` already uses for a public embed id, except this
 * one requires an authenticated admin rather than being public). A normal
 * authenticated business visiting `/admin/businesses/<their own id>` still
 * gets redirected to `/dashboard` by the layout before this page ever
 * runs, since `requireAdminContext()` checks `is_admin`, not whether the
 * id happens to match their own business.
 */
export default async function AdminBusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, session } = await requireAdminContext();
  const { id } = await params;
  const detail = await getBusinessDetailAdmin(db, session, id);
  if (!detail) notFound();

  const { business, owner, subscription, pricingConfigVersion, quoteCount, customerCount, acceptedCount, declinedCount, recentQuotes } =
    detail;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/businesses" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
            ← Businesses
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{business.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Quotes" value={String(quoteCount)} />
        <MetricCard label="Customers" value={String(customerCount)} />
        <MetricCard label="Accepted" value={String(acceptedCount)} />
        <MetricCard label="Declined" value={String(declinedCount)} />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Account</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <Row label="Business name" value={business.name} />
            <Row label="Owner" value={owner?.email ?? "—"} />
            <Row label="Business email" value={business.email} />
            <Row label="Account created" value={formatDateTime(business.createdAt)} />
            <Row label="Business ID" value={<code className="text-xs">{business.id}</code>} />
            <Row label="Onboarding" value={business.needsOnboarding ? "Incomplete" : "Complete"} />
          </dl>
        </div>

        <div className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Subscription</h2>
          {subscription ? (
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <Row label="Plan" value={PLAN_LABELS[subscription.planId] ?? subscription.planId} />
              <Row label="Status" value={describeSubscriptionStatus(subscription.status, subscription.providerStatus)} />
              <Row
                label="Stripe raw status"
                value={subscription.providerStatus ?? "Unknown (not yet synced)"}
              />
              <Row label="Trial used" value={subscription.trialUsedAt ? formatDateTime(subscription.trialUsedAt) : "Never"} />
              <Row label="Trial ends" value={subscription.trialEndsAt ? formatDateTime(subscription.trialEndsAt) : "—"} />
              <Row label="Subscription created" value={formatDateTime(subscription.createdAt)} />
              <Row label="Canceled" value={subscription.canceledAt ? formatDateTime(subscription.canceledAt) : "No"} />
              <Row
                label="Cancels at period end"
                value={subscription.cancelAtPeriodEnd ? formatDateTime(subscription.cancelAt) : "No"}
              />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">No subscription on file (legacy/pre-billing access).</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Configuration</h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <Row label="Public embed ID" value={<code className="text-xs">{business.publicEmbedId}</code>} />
          <Row label="Embed last seen" value={business.embedLastSeenAt ? formatDateTime(business.embedLastSeenAt) : "Never"} />
          <Row label="Branding" value={business.logoUrl || business.brandColor ? "Customized" : "Default"} />
          <Row label="Pricing configuration version" value={pricingConfigVersion ? `v${pricingConfigVersion}` : "—"} />
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Recent quotes</h2>
        {recentQuotes.length === 0 ? (
          <p className="text-sm text-ink-soft">No quotes yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Estimate</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recentQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <td className="px-4 py-3 text-ink">{quote.customer.name || "Unnamed customer"}</td>
                    <td className="px-4 py-3">
                      <QuoteStatusBadge status={quote.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-ink">{formatEstimate(quote)}</td>
                    <td className="px-4 py-3 text-ink-faint">{formatDateTime(quote.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div>
        <Link href="/admin/businesses" className={buttonVariants({ variant: "outline" })}>
          Back to businesses
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
