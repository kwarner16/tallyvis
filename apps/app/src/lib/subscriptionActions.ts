"use server";

import { revalidatePath } from "next/cache";
import {
  BillingProviderError,
  createCheckoutSessionForPlan,
  startTrial as apiStartTrial,
  type Subscription,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { APP_URL } from "./urls";

/**
 * Phase 14 — SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md). Same
 * `requireContext()`-derives-the-business pattern every other mutation in
 * this app already follows — nothing here accepts or trusts a
 * client-supplied businessId.
 */

export async function startTrialAction(planId: string): Promise<Subscription> {
  const { db, session } = await requireContext();
  const subscription = apiStartTrial(db, session, planId);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/billing");
  return subscription;
}

/**
 * Creates a real Stripe Checkout session and returns the URL to redirect
 * to — only succeeds when billing is actually configured
 * (`STRIPE_SECRET_KEY` set); throws a plain, safe-to-display message
 * otherwise ("Billing isn't configured...") rather than a raw provider
 * error, the same `BillingProviderError`-to-`Error.message` pattern
 * `quoteActions.ts` already uses for `AiProviderError`.
 */
export async function createCheckoutSessionAction(planId: string): Promise<{ url: string }> {
  const { db, session } = await requireContext();
  try {
    return await createCheckoutSessionForPlan(db, session, planId, {
      successUrl: `${APP_URL}/dashboard/billing?checkout=success`,
      cancelUrl: `${APP_URL}/dashboard/billing?checkout=canceled`,
    });
  } catch (err) {
    if (err instanceof BillingProviderError) throw new Error(err.message);
    throw err;
  }
}
