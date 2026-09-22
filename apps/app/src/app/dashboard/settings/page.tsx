import { Suspense } from "react";
import Link from "next/link";
import { getPlan, TRIAL_DAYS } from "@tallyvis/config";
import { getCurrentBusiness, getCurrentUser, getSubscription, resolveEffectiveStatus } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { requireContext } from "@/lib/session";
import { SettingsPageClient } from "@/components/dashboard/SettingsPageClient";
import { ManageBillingButton } from "@/components/dashboard/ManageBillingButton";
import { DangerZoneClient } from "@/components/dashboard/DangerZoneClient";
import { GoogleErrorBanner } from "@/components/auth/GoogleErrorBanner";
import { GoogleLinkedBanner } from "@/components/auth/GoogleLinkedBanner";

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  canceled: "Canceled",
  expired: "Expired",
  incomplete: "Incomplete",
};

const PROVIDER_LABELS: Record<string, string> = { google: "Google" };

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). One page
 * covering everything Part 25's brief asks a business owner to be able
 * to answer at a glance: who am I signed in as and how, what plan/trial/
 * cancellation state is my billing in, and how do I permanently delete
 * my account — without exposing any internal id (Stripe Customer/
 * Subscription id, database id, provider id) anywhere on the page.
 */
export default async function SettingsPage() {
  const { db, session } = await requireContext();
  const business = await getCurrentBusiness(db, session);
  const user = await getCurrentUser(db, session);
  const subscription = await getSubscription(db, session);

  const plan = subscription ? getPlan(subscription.planId) : undefined;
  const effectiveStatus = subscription ? resolveEffectiveStatus(subscription) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="text-ink-soft">Your account, billing, and business details.</p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Account</p>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-soft">Email</span>
            <span className="font-medium text-ink">{user.email}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-soft">Signed in with</span>
            <span className="font-medium text-ink">
              {[user.hasPassword ? "Email & password" : null, ...user.linkedProviders.map((p) => PROVIDER_LABELS[p] ?? p)]
                .filter(Boolean)
                .join(" + ")}
            </span>
          </div>
          {user.hasPassword ? (
            <div className="mt-1">
              <Link href="/forgot-password" className="text-sm font-medium text-accent-strong hover:underline">
                Change password
              </Link>
            </div>
          ) : null}
          {!user.linkedProviders.includes("google") ? (
            <div className="mt-1">
              <a href="/api/auth/google/start" className="text-sm font-medium text-accent-strong hover:underline">
                Connect Google
              </a>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Suspense fallback={null}>
            <GoogleErrorBanner />
          </Suspense>
          <Suspense fallback={null}>
            <GoogleLinkedBanner />
          </Suspense>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Billing</p>
        {!subscription ? (
          <div className="mt-3">
            <p className="text-sm text-ink-soft">You haven&rsquo;t chosen a plan yet.</p>
            <Link href="/dashboard/onboarding" className={buttonVariants({ variant: "primary", className: "mt-3" })}>
              Choose a plan
            </Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-semibold text-ink">{plan?.name ?? subscription.planId}</span>
              <span
                className={
                  subscription.cancelAtPeriodEnd
                    ? "rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
                    : "rounded-full bg-paper-alt px-3 py-1 text-xs font-medium text-ink-soft"
                }
              >
                {STATUS_LABELS[effectiveStatus ?? subscription.status] ?? subscription.status}
                {subscription.cancelAtPeriodEnd ? " · Canceling" : ""}
              </span>
            </div>
            {effectiveStatus === "trialing" && subscription.trialEndsAt ? (
              <p className="text-sm text-ink-soft">
                7-day trial (up to {TRIAL_DAYS} days) — ends{" "}
                {new Date(subscription.trialEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
              </p>
            ) : null}
            {subscription.cancelAtPeriodEnd && subscription.cancelAt ? (
              <p className="text-sm text-amber-800">
                Cancellation scheduled for{" "}
                {new Date(subscription.cancelAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {subscription.billingCustomerId ? <ManageBillingButton /> : null}
              <Link href="/dashboard/billing" className={buttonVariants({ variant: "outline" })}>
                View billing details
              </Link>
            </div>
          </div>
        )}
      </div>

      <SettingsPageClient initialBusiness={business} />

      <DangerZoneClient />
    </div>
  );
}
