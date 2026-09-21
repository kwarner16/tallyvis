import { cookies } from "next/headers";
import { isPlanId } from "@tallyvis/config";
import { billingConfigured } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { INTENDED_PLAN_COOKIE_NAME } from "@/lib/constants";
import { PlanSelector } from "@/components/dashboard/PlanSelector";

/**
 * Phase 14 — plan selection (see
 * docs/decisions/0016-onboarding-billing-embed.md).
 *
 * Hardening note (post-launch audit): this page previously called
 * `cookies().delete(...)` directly in the Server Component's render body
 * to consume the intended-plan cookie. Next.js only allows cookies to be
 * mutated inside a Server Action or Route Handler — doing it here threw
 * "Cookies can only be modified in a Server Action or Route Handler" on
 * every single render, which is exactly the "Choose Plan" error this was
 * reported as. The cookie is now only ever READ here (reading during
 * render is fine); it's cleared as a side effect of `startTrialAction`/
 * `createCheckoutSessionAction` in `subscriptionActions.ts`, both real
 * Server Actions, once a plan is actually chosen. Until then the cookie
 * simply expires on its own (1 hour) — harmless either way.
 */
export default async function OnboardingPage() {
  await requireContext();

  const store = await cookies();
  const rawIntendedPlan = store.get(INTENDED_PLAN_COOKIE_NAME)?.value;
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
