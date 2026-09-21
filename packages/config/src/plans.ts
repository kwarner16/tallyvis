/**
 * Phase 14 — the single authoritative subscription plan definition, shared
 * by apps/web's marketing pricing section and apps/app's onboarding/billing
 * screens so the two can never drift apart (see
 * docs/decisions/0016-onboarding-billing-embed.md: "do not duplicate plan
 * definitions between frontend and backend"). `services/api` also reads
 * this to validate a `planId` before creating a subscription — nothing
 * about a plan's price or features is ever hard-coded a second time
 * anywhere else in the repo.
 *
 * These are the same three tiers apps/web's `Pricing` component already
 * displayed before this phase (Starter/Growth/Pro) — centralized here
 * unchanged, not renumbered or repriced. "Enterprise" stays a
 * contact-sales tier or, since it isn't a self-serve plan, it is not
 * represented here at all; the marketing page keeps its own "Talk to us"
 * card for it, pointing at /contact exactly as before.
 */

export type PlanId = "starter" | "growth" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPriceCents: number;
  description: string;
  features: string[];
  /** Highlighted as the recommended choice in plan-selection UI — cosmetic only, not a functional difference. */
  featured?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 7900,
    description: "For a single crew getting started with window-cleaning estimating.",
    features: ["Window cleaning estimating", "Core business dashboard", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 14900,
    description: "For businesses ready to put quoting on their own website.",
    features: ["Everything in Starter", "Website embed widget", "Priority support"],
    featured: true,
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPriceCents: 29900,
    description: "For multi-crew operations that need more visibility.",
    features: ["Everything in Growth", "Multiple locations", "Advanced reporting"],
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function isPlanId(id: string): id is PlanId {
  return PLANS.some((plan) => plan.id === id);
}

/** Every new subscription's trial length — see docs/decisions/0016. */
export const TRIAL_DAYS = 7;

/**
 * A one-time charge, separate from the recurring plan subscription — see
 * docs/decisions/0016 for why these are modeled as distinct billing
 * concepts. `amountCents` is a placeholder default, not a validated
 * pricing decision: CLAUDE.md's "Product ownership" section reserves
 * actual pricing calls for the founder, exactly like it does for
 * marketing claims — treat this the same way you'd treat a labeled mock,
 * not as a final number.
 */
export const WEBSITE_INSTALLATION_FEE = {
  kind: "website_installation" as const,
  amountCents: 19900,
  currency: "USD",
  description: "One-time website installation & setup",
};
