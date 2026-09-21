"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  BillingProviderError,
  createCheckoutSessionForPlan,
  startTrial as apiStartTrial,
  type Subscription,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { APP_URL } from "./urls";
import { INTENDED_PLAN_COOKIE_NAME } from "./constants";

/**
 * Phase 14 — SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md). Same
 * `requireContext()`-derives-the-business pattern every other mutation in
 * this app already follows — nothing here accepts or trusts a
 * client-supplied businessId, and a plan id is always re-validated
 * server-side (`apiStartTrial`/`createCheckoutSessionForPlan` both reject
 * anything not in `@tallyvis/config`'s `PLANS`) — never trusted just
 * because the browser sent it.
 *
 * Both actions clear the intended-plan cookie (set at signup from a
 * marketing-site pricing link) as a side effect of actually choosing a
 * plan — cookie mutation is only legal here, inside a real Server Action,
 * never in `/dashboard/onboarding`'s own render (see that page's comment
 * for the bug this fixes).
 *
 * Error handling: only a small, deliberately-safe set of messages ever
 * reaches the browser — `BillingProviderError`'s own message (already
 * hand-written to be safe, e.g. "Billing isn't configured...") or the
 * handful of validation messages the service layer throws (e.g. "Unknown
 * plan"). Anything else (a database error, a network failure, any
 * unexpected exception) is logged server-side with full detail and
 * replaced with one generic, safe message — the browser never sees a
 * stack trace, a SQL error, or a raw provider exception.
 */

const GENERIC_TRIAL_ERROR = "Could not start your trial. Please try again.";
const GENERIC_CHECKOUT_ERROR = "We couldn't start checkout. Please try again.";

/** Messages the service layer deliberately hand-writes for the caller to see as-is — never derived from a raw exception, never containing internal ids/details. */
const SAFE_MESSAGE_PATTERN = /^Unknown plan "/;

export async function startTrialAction(planId: string): Promise<Subscription> {
  const { db, session } = await requireContext();
  try {
    const subscription = apiStartTrial(db, session, planId);
    (await cookies()).delete(INTENDED_PLAN_COOKIE_NAME);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/billing");
    return subscription;
  } catch (err) {
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) throw err;
    console.error("startTrialAction failed:", err);
    throw new Error(GENERIC_TRIAL_ERROR);
  }
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
    const result = await createCheckoutSessionForPlan(db, session, planId, {
      successUrl: `${APP_URL}/dashboard/billing?checkout=success`,
      cancelUrl: `${APP_URL}/dashboard/billing?checkout=canceled`,
    });
    (await cookies()).delete(INTENDED_PLAN_COOKIE_NAME);
    return result;
  } catch (err) {
    if (err instanceof BillingProviderError) throw new Error(err.message);
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) throw err;
    console.error("createCheckoutSessionAction failed:", err);
    throw new Error(GENERIC_CHECKOUT_ERROR);
  }
}
