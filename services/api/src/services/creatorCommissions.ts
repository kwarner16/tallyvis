import type { Queryable } from "../db/pg/client";
import { isUniqueViolation } from "../db/pg/client";
import type { StripeInvoiceObject, StripeChargeObject } from "../billing/types";
import * as subscriptionsRepo from "../repositories/subscriptions";
import * as creatorsRepo from "../repositories/creators";
import * as referralsRepo from "../repositories/creatorReferrals";
import * as commissionsRepo from "../repositories/creatorCommissions";
import * as adjustmentsRepo from "../repositories/creatorCommissionAdjustments";

/**
 * TallyVis Founding Creator Program — commission calculation from real
 * Stripe invoice payments (see
 * docs/decisions/0040-creator-affiliate-program.md and its V1.1
 * addendum for the full reasoning behind every decision below). Called
 * from `services/billingWebhooks.ts`'s `invoice.paid`/`charge.refunded`
 * branches — this file has no webhook-signature or event-envelope
 * concerns of its own, only the business logic of "does this payment
 * produce a commission, how much, and how does a later refund adjust
 * it."
 */

async function resolveBusinessIdForInvoice(db: Queryable, invoice: StripeInvoiceObject): Promise<string | undefined> {
  if (!invoice.subscription) return undefined;
  const subscription = await subscriptionsRepo.getSubscriptionByProviderSubscriptionId(db, invoice.subscription);
  return subscription?.businessId;
}

/** UTC calendar-month addition — matches `period_start`'s own UTC-second Stripe timestamp semantics, deliberately not affected by server-local timezone. */
function addMonthsUtc(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

/**
 * The one function that turns a real, successful invoice payment into a
 * commission row (or correctly decides not to). Every early return below
 * is a deliberate "no commission, and that's correct" outcome, not an
 * error:
 *
 *   - `amount_paid <= 0`: a $0 invoice (e.g. the very first invoice
 *     during a Stripe-trial period) collected nothing — there is no
 *     revenue to take a percentage of. This is also what correctly
 *     excludes a FAILED payment from ever reaching this function at all:
 *     Stripe only emits `invoice.paid` for an invoice that was actually
 *     paid; `invoice.payment_failed` is a different event type this
 *     function is never called for.
 *   - no resolvable business / no referral: an invoice for a business
 *     this app doesn't recognize, or one that was never referred by a
 *     creator — most invoices, by far, correctly produce no commission.
 *     NOTE: deliberately does NOT check the creator's current `status`
 *     — see docs/decisions/0040's V1.1 addendum, "Existing referrals
 *     after deactivation": a creator who legitimately referred this
 *     business while active keeps earning eligible commission for the
 *     rest of the original eligibility window even after being
 *     paused/deactivated. Only NEW attribution (`resolveEligibleCreatorBySlug`,
 *     used by `attributeReferral`) requires `status === "active"`.
 *   - outside the eligibility window: see the window-start/cutoff logic
 *     below.
 *
 * One-time fees (the installation fee) never reach this function at all
 * — they're `mode: "payment"` Checkout Sessions, which never produce a
 * Stripe Invoice object in the first place, so there is nothing to
 * special-case.
 *
 * Idempotent via `creator_commissions.stripe_invoice_id UNIQUE` — a
 * replayed `invoice.paid` webhook (Stripe's explicit at-least-once
 * delivery) hits that constraint and is treated as a no-op here, never a
 * duplicate commission.
 */
export async function processInvoicePaid(db: Queryable, invoice: StripeInvoiceObject): Promise<void> {
  if (!(invoice.amount_paid > 0)) return;

  const businessId = await resolveBusinessIdForInvoice(db, invoice);
  if (!businessId) return;

  const referral = await referralsRepo.getCreatorReferralByBusinessId(db, businessId);
  if (!referral) return;

  const creator = await creatorsRepo.getCreatorById(db, referral.creatorId);
  if (!creator) return;

  const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : new Date().toISOString();
  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : undefined;

  // The 12-month (or whatever this creator's CURRENT
  // commissionDurationMonths is) eligibility window starts at the first
  // ever commission-eligible invoice for this referral, and is stamped
  // exactly once — see `startCommissionWindowIfUnset`'s own comment. Every
  // SUBSEQUENT invoice (including this one, if it's the first) is
  // evaluated against that fixed start plus the creator's CURRENT
  // duration — so raising a creator's duration later extends eligibility
  // for invoices going forward without needing to touch any historical
  // row, exactly the "vary by creator without rewriting history"
  // requirement. The window is tied to the REFERRAL, not to the
  // creator's current status — see this function's own header comment.
  let windowStartedAt = referral.commissionWindowStartedAt;
  if (!windowStartedAt) {
    await referralsRepo.startCommissionWindowIfUnset(db, referral.id, periodStart);
    windowStartedAt = periodStart;
  }

  const cutoff = addMonthsUtc(windowStartedAt, creator.commissionDurationMonths);
  if (Date.parse(periodStart) >= Date.parse(cutoff)) {
    return;
  }

  // Tax exclusion (V1.1 — see docs/decisions/0040's addendum "What
  // revenue is commissionable" section): `invoice.tax` is Stripe's own
  // authoritative total-tax-collected field, present whenever Stripe Tax
  // or a manual tax rate is in use. Absent/zero (this account's current
  // situation) means commissionableAmountCents === collectedAmountCents
  // exactly, so nothing changes from V1 behavior today — this only takes
  // effect if/when tax collection is ever turned on.
  const collectedAmountCents = invoice.amount_paid;
  const taxCents = invoice.tax ?? 0;
  const commissionableAmountCents = Math.max(0, collectedAmountCents - taxCents);

  // Integer-cents arithmetic throughout, matching every other money value
  // in this repo (`monthlyPriceCents`, `amountCents`, ...) — bps/10000
  // first multiplies, then divides, so this never touches a float.
  const commissionAmountCents = Math.round((commissionableAmountCents * creator.commissionRateBps) / 10_000);

  try {
    await commissionsRepo.createCreatorCommission(db, {
      creatorId: creator.id,
      referralId: referral.id,
      businessId,
      stripeInvoiceId: invoice.id,
      stripeChargeId: invoice.charge ?? undefined,
      collectedAmountCents,
      commissionableAmountCents,
      currency: invoice.currency,
      commissionRateBps: creator.commissionRateBps,
      commissionAmountCents,
      periodStart,
      periodEnd,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

/**
 * Applies a (possibly repeated, possibly partial) refund to every
 * commission produced by this charge's invoice — see
 * docs/decisions/0040's V1.1 addendum "Refunds" section for the full
 * accounting design this implements:
 *
 *   - Proportional, not all-or-nothing: `charge.amount_refunded` is
 *     Stripe's own CUMULATIVE refunded total for this charge (never a
 *     per-event delta) — scaled by the same ratio the commissionable
 *     base already was to the gross collected amount (so tax exclusion
 *     and refund proportionality compose correctly; see the scaling
 *     comment below), then handed to `applyRefundToCommission`, which
 *     re-derives the total reversal from scratch every time. This is
 *     what makes a SECOND partial refund correctly compute a larger
 *     (but still capped) total reversal, and what makes an EXACT replay
 *     of the same webhook event a safe no-op rather than a double
 *     reversal.
 *   - Full refund -> full reversal; partial -> proportional; multiple
 *     partials can never over-reverse (capped at `commissionAmountCents`
 *     inside `applyRefundToCommission`).
 *   - An already-`'paid'` commission's own amounts/status are NEVER
 *     touched (see that function's comment) — instead, the INCREMENTAL
 *     new reversal is recorded as a negative `creator_commission_adjustments`
 *     ledger entry, to net against this creator's NEXT payout, exactly
 *     the "prefer an adjustment/negative balance over an automatic
 *     clawback" treatment the business rule calls for. No automated
 *     payout or bank action results from this — V1.1 still has none.
 */
export async function processChargeRefunded(db: Queryable, charge: StripeChargeObject): Promise<void> {
  if (!charge.refunded && !(charge.amount_refunded > 0)) return;

  const commissions = await commissionsRepo.listCommissionsByStripeChargeId(db, charge.id);
  for (const commission of commissions) {
    // Scales the charge's cumulative refunded amount into the
    // commissionable-base "currency" this commission's reversal math
    // operates in — a no-op ratio (1:1) whenever no tax was excluded
    // (collectedAmountCents === commissionableAmountCents, today's
    // reality for this account), and a documented, deliberate
    // approximation otherwise: Stripe has no API concept of "refund only
    // the non-tax portion," so a refund is assumed to reduce the
    // commissionable base in the same proportion it reduced the gross
    // collected amount.
    const scaledRefundedCents =
      commission.collectedAmountCents > 0
        ? Math.round((charge.amount_refunded * commission.commissionableAmountCents) / commission.collectedAmountCents)
        : 0;

    const result = await commissionsRepo.applyRefundToCommission(db, commission.id, scaledRefundedCents);
    if (!result || result.incrementalReversalCents <= 0) continue;

    if (result.wasAlreadyPaid) {
      await adjustmentsRepo.createCommissionAdjustment(db, {
        commissionId: commission.id,
        creatorId: commission.creatorId,
        amountCents: -result.incrementalReversalCents,
        reason: "refund_after_payout",
        note: `Refund on Stripe charge ${charge.id} after this commission was already paid.`,
      });
    }
  }
}
