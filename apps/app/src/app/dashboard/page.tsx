import Link from "next/link";
import type { Quote } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { getActiveConfiguration, getCurrentBusiness, getSubscription, listQuotes, resolveEffectiveStatus } from "@tallyvis/api";
import { TRIAL_DAYS } from "@tallyvis/config";
import { requireContext } from "@/lib/session";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { QuoteList } from "@/components/dashboard/QuoteList";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";

const ACTIVE_STATUSES: Quote["status"][] = [
  "new",
  "needs_review",
  "more_information",
  "approved",
  "sent",
];

export default async function DashboardHomePage() {
  const { db, session } = await requireContext();
  const quotes = listQuotes(db, session);
  const business = getCurrentBusiness(db, session);
  const subscription = getSubscription(db, session);
  const pricingConfiguration = getActiveConfiguration(db, session);

  const checklistItems = [
    { key: "plan", label: "Choose a plan", href: "/dashboard/onboarding", done: subscription !== undefined },
    { key: "pricing", label: "Configure your pricing", href: "/dashboard/pricing", done: pricingConfiguration.version > 1 },
    {
      key: "branding",
      label: "Customize your estimator",
      href: "/dashboard/settings",
      done: Boolean(business.logoUrl || business.brandColor),
    },
    {
      key: "website",
      label: "Add Tallyvis to your website",
      href: "/dashboard/website",
      done: Boolean(business.embedLastSeenAt),
    },
    { key: "test-estimate", label: "Run a test estimate", href: "/estimate", done: quotes.length > 0 },
  ];

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Good morning.
          </h1>
          <p className="text-ink-soft">Here&rsquo;s what&rsquo;s happening with your quotes.</p>
        </div>
        <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "primary" })}>
          New quote
        </Link>
      </div>

      {!subscription ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent bg-accent-soft p-5">
          <div>
            <p className="text-sm font-semibold text-accent-strong">Start your {TRIAL_DAYS}-day free trial</p>
            <p className="text-sm text-ink-soft">Choose a plan to unlock the full Tallyvis dashboard.</p>
          </div>
          <Link href="/dashboard/onboarding" className={buttonVariants({ variant: "primary" })}>
            Choose a plan
          </Link>
        </div>
      ) : resolveEffectiveStatus(subscription) === "expired" ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-5">
          <div>
            <p className="text-sm font-semibold text-red-700">Your trial has ended</p>
            <p className="text-sm text-red-700/80">Reactivate your plan to keep creating quotes.</p>
          </div>
          <Link href="/dashboard/billing" className={buttonVariants({ variant: "primary" })}>
            Reactivate
          </Link>
        </div>
      ) : null}

      <OnboardingChecklist items={checklistItems} />

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
