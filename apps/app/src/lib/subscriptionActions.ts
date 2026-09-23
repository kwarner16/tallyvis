"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  BillingProviderError,
  createCheckoutSessionForPlan,
  createInstallationCheckoutSession,
  chooseSelfInstall,
  createBillingPortalSession,
  startTrial as apiStartTrial,
  type Subscription,
  type BillingCharge,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { APP_URL } from "./urls";
import { INTENDED_PLAN_COOKIE_NAME } from "./constants";
import type { ActionResult } from "./actionResult";

/**
 * Phase 14 SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md), extended for V1 in
 * docs/decisions/0018-stripe-v1-hardening.md. Same
 * `requireContext()`-derives-the-business pattern every other mutation in
 * this app already follows — nothing here accepts or trusts a
 * client-supplied businessId, and a plan id is always re-validated
 * server-side (the service layer rejects anything not in
 * `@tallyvis/config`'s `PLANS`) — never trusted just because the browser
 * sent it.
 *
 * Both plan actions clear the intended-plan cookie (set at signup from a
 * marketing-site pricing link) as a side effect of actually choosing a
 * plan — cookie mutation is only legal here, inside a real Server Action,
 * never in `/dashboard/onboarding`'s own render (see that page's comment
 * for the bug this fixes).
 *
 * Error handling: every action returns an `ActionResult` (see
 * actionResult.ts) rather than throwing — a thrown error's real message is
 * stripped in a production build, which these actions used to hit before
 * this fix. Only a small, deliberately-safe set of messages ever reaches
 * the browser — `BillingProviderError`'s own message (already hand-written
 * to be safe, e.g. "Billing isn't configured...") or the handful of
 * validation messages the service layer throws (e.g. "Unknown plan",
 * "Installation has already been resolved..."). Anything else (a database
 * error, a network failure, any unexpected exception) is logged
 * server-side with full detail and replaced with one generic, safe
 * message — the browser never sees a stack trace, a SQL error, or a raw
 * provider exception.
 */

const GENERIC_TRIAL_ERROR = "Could not start your trial. Please try again.";
const GENERIC_CHECKOUT_ERROR = "We couldn't start checkout. Please try again.";
const GENERIC_INSTALLATION_ERROR = "We couldn't start installation checkout. Please try again.";
const GENERIC_SELF_INSTALL_ERROR = "Could not record your installation choice. Please try again.";
const GENERIC_PORTAL_ERROR = "Could not open your billing portal. Please try again.";

/** Messages the service layer deliberately hand-writes for the caller to see as-is — never derived from a raw exception, never containing internal ids/details. */
const SAFE_MESSAGE_PATTERN = /^(Unknown plan "|Installation has already been resolved|No billing account yet)/;

/**
 * DB-only, no-card trial start — NOT called by any production UI as of the
 * Stripe V1 hardening pass (see `services/subscriptions.ts`'s `startTrial`
 * comment and docs/decisions/0018). Retained for tests/internal use only.
 */
export async function startTrialAction(planId: string): Promise<ActionResult<Subscription>> {
  const { db, session } = await requireContext();
  try {
    const subscription = await apiStartTrial(db, session, planId);
    (await cookies()).delete(INTENDED_PLAN_COOKIE_NAME);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/billing");
    return { ok: true, data: subscription };
  } catch (err) {
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) return { ok: false, message: err.message };
    console.error("startTrialAction failed:", err);
    return { ok: false, message: GENERIC_TRIAL_ERROR };
  }
}

/**
 * Creates a real Stripe Checkout session (mode: subscription, 7-day trial,
 * card required) and returns the URL to redirect to — the ONE production
 * onboarding path. Only succeeds when billing is actually configured
 * (`STRIPE_SECRET_KEY` and that plan's Price id both set); throws a plain,
 * safe-to-display message otherwise rather than a raw provider error.
 */
export async function createCheckoutSessionAction(planId: string): Promise<ActionResult<{ url: string }>> {
  const { db, session } = await requireContext();
  try {
    const result = await createCheckoutSessionForPlan(db, session, planId, {
      successUrl: `${APP_URL}/dashboard/billing?checkout=success`,
      cancelUrl: `${APP_URL}/dashboard/billing?checkout=canceled`,
    });
    (await cookies()).delete(INTENDED_PLAN_COOKIE_NAME);
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof BillingProviderError) return { ok: false, message: err.message };
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) return { ok: false, message: err.message };
    console.error("createCheckoutSessionAction failed:", err);
    return { ok: false, message: GENERIC_CHECKOUT_ERROR };
  }
}

/** Creates a real Stripe Checkout session (mode: payment, one-time) for the optional $299 professional installation fee. */
export async function createInstallationCheckoutSessionAction(): Promise<ActionResult<{ url: string }>> {
  const { db, session } = await requireContext();
  try {
    const result = await createInstallationCheckoutSession(db, session, {
      successUrl: `${APP_URL}/dashboard/billing?installation=success`,
      cancelUrl: `${APP_URL}/dashboard/billing?installation=canceled`,
    });
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof BillingProviderError) return { ok: false, message: err.message };
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) return { ok: false, message: err.message };
    console.error("createInstallationCheckoutSessionAction failed:", err);
    return { ok: false, message: GENERIC_INSTALLATION_ERROR };
  }
}

/** Records a self-install choice (free, no Stripe interaction). */
export async function chooseSelfInstallAction(): Promise<ActionResult<BillingCharge>> {
  const { db, session } = await requireContext();
  try {
    const charge = await chooseSelfInstall(db, session);
    revalidatePath("/dashboard/billing");
    return { ok: true, data: charge };
  } catch (err) {
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) return { ok: false, message: err.message };
    console.error("chooseSelfInstallAction failed:", err);
    return { ok: false, message: GENERIC_SELF_INSTALL_ERROR };
  }
}

/** Creates a Stripe Customer Portal session so the business can manage its own billing, and returns the URL to redirect to. */
export async function createBillingPortalSessionAction(): Promise<ActionResult<{ url: string }>> {
  const { db, session } = await requireContext();
  try {
    const result = await createBillingPortalSession(db, session, `${APP_URL}/dashboard/billing`);
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof BillingProviderError) return { ok: false, message: err.message };
    if (err instanceof Error && SAFE_MESSAGE_PATTERN.test(err.message)) return { ok: false, message: err.message };
    console.error("createBillingPortalSessionAction failed:", err);
    return { ok: false, message: GENERIC_PORTAL_ERROR };
  }
}
