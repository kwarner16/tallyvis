import { cookies } from "next/headers";
import { isPlanId } from "@tallyvis/config";
import { billingConfigured } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { INTENDED_PLAN_COOKIE_NAME } from "@/lib/constants";
import { PlanSelector } from "@/components/dashboard/PlanSelector";

/**
 * Phase 14 — plan selection (see
 * docs/decisions/0016-onboarding-billing-embed.md). The intended-plan
 * cookie set at signup (from a marketing-site pricing link) is read once
 * and cleared here — it only ever preselects a radio-equivalent, it never
 * starts a trial on its own.
 */
export default async function OnboardingPage() {
  await requireContext();

  const store = await cookies();
  const rawIntendedPlan = store.get(INTENDED_PLAN_COOKIE_NAME)?.value;
  store.delete(INTENDED_PLAN_COOKIE_NAME);
  const intendedPlanId = rawIntendedPlan && isPlanId(rawIntendedPlan) ? rawIntendedPlan : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Choose your plan</h1>
        <p className="text-ink-soft">
          Every plan includes a <span className="font-medium text-ink">7-day free trial</span> — no
          credit card required to start.
        </p>
      </div>
      <PlanSelector initialPlanId={intendedPlanId} billingIsConfigured={billingConfigured()} />
    </div>
  );
}
