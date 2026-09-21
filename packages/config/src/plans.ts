/**
 * Phase 14 (updated in the Phase 14 Stripe V1 hardening pass) — the single
 * authoritative subscription plan definition, shared by apps/web's
 * marketing pricing section and apps/app's onboarding/billing screens so
 * the two can never drift apart (see
 * docs/decisions/0016-onboarding-billing-embed.md: "do not duplicate plan
 * definitions between frontend and backend"). `services/api` also reads
 * this to validate a `planId` before creating a subscription — nothing
 * about a plan's price or features is ever hard-coded a second time
 * anywhere else in the repo.
 *
 * `monthlyPriceCents` is the founder-approved, final V1 public price (see
 * docs/decisions/0018-stripe-v1-hardening.md) — no longer a placeholder.
 * `stripePriceEnvVar` names, but never holds, the environment variable that
 * resolves this plan's real Stripe recurring Price ID. Test-mode and
 * live-mode Stripe accounts issue different Price ids for "the same" plan,
 * so the id itself is environment configuration, not something committed
 * here — only `services/api/src/billing/index.ts` ever reads these env
 * vars. This is what lets local dev/test point at Stripe test-mode prices
 * while a future production deployment points at live-mode prices, without
 * risking one environment accidentally billing against the other's price.
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
  /** Name of the env var holding this plan's real Stripe recurring Price id for the running environment — see this file's header comment. */
  stripePriceEnvVar: string;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 6900,
    description: "For a single crew getting started with window-cleaning estimating.",
    features: ["Window cleaning estimating", "Core business dashboard", "Email support"],
    stripePriceEnvVar: "STRIPE_PRICE_STARTER",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 15900,
    description: "For businesses ready to put quoting on their own website.",
    features: ["Everything in Starter", "Website embed widget", "Priority support"],
    featured: true,
    stripePriceEnvVar: "STRIPE_PRICE_GROWTH",
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPriceCents: 29900,
    description: "For multi-crew operations that need more visibility.",
    features: ["Everything in Growth", "Multiple locations", "Advanced reporting"],
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function isPlanId(id: string): id is PlanId {
  return PLANS.some((plan) => plan.id === id);
}

/** Every new subscription's trial length — see docs/decisions/0016. Card required upfront (via Stripe Checkout); Stripe owns the trial clock once a real subscription exists — see docs/decisions/0018-stripe-v1-hardening.md. */
export const TRIAL_DAYS = 7;

/**
 * The optional, one-time professional installation fee — deliberately
 * modeled separately from the recurring plan subscription (see
 * docs/decisions/0016 and 0018). A business may instead choose self-install
 * at no cost, which never creates a Stripe charge at all (see
 * `services/api/src/services/subscriptions.ts`'s `chooseSelfInstall`).
 * `amountCents` is the founder-approved, final V1 public price — no longer
 * a placeholder.
 */
export const PROFESSIONAL_INSTALLATION_FEE = {
  kind: "website_installation" as const,
  amountCents: 29900,
  currency: "USD",
  description: "One-time professional website installation & setup",
  /** Name of the env var holding this one-time charge's real Stripe Price id for the running environment — see this file's header comment. */
  stripePriceEnvVar: "STRIPE_PRICE_INSTALLATION",
};
