import type { Queryable } from "../db/pg/client";
import { isUniqueViolation } from "../db/pg/client";
import type { StripeInvoiceObject, StripeChargeObject } from "../billing/types";
import * as subscriptionsRepo from "../repositories/subscriptions";
import * as creatorsRepo from "../repositories/creators";
import * as referralsRepo from "../repositories/creatorReferrals";
import * as commissionsRepo from "../repositories/creatorCommissions";

/**
 * TallyVis Founding Creator Program — commission calculation from real
 * Stripe invoice payments (see
 * docs/decisions/0040-creator-affiliate-program.md's "Stripe /
 * commissions" section for the full reasoning behind every decision
 * below). Called from `services/billingWebhooks.ts`'s new `invoice.paid`/
 * `charge.refunded` branches — this file has no webhook-signature or
 * event-envelope concerns of its own, only the business logic of "does
 * this payment produce a commission, and how much."
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
 *   - outside the eligibility window: see the window-start/cutoff logic
 *     below.
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
  // requirement.
  let windowStartedAt = referral.commissionWindowStartedAt;
  if (!windowStartedAt) {
    await referralsRepo.startCommissionWindowIfUnset(db, referral.id, periodStart);
    windowStartedAt = periodStart;
  }

  const cutoff = addMonthsUtc(windowStartedAt, creator.commissionDurationMonths);
  if (Date.parse(periodStart) >= Date.parse(cutoff)) {
    return;
  }

  // Integer-cents arithmetic throughout, matching every other money value
  // in this repo (`monthlyPriceCents`, `amountCents`, ...) — bps/10000
  // first multiplies, then divides, so this never touches a float.
  const commissionAmountCents = Math.round((invoice.amount_paid * creator.commissionRateBps) / 10_000);

  try {
    await commissionsRepo.createCreatorCommission(db, {
      creatorId: creator.id,
      referralId: referral.id,
      businessId,
      stripeInvoiceId: invoice.id,
      stripeChargeId: invoice.charge ?? undefined,
      collectedAmountCents: invoice.amount_paid,
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
 * Reverses every commission produced by this charge's invoice when any
 * amount of it has been refunded — a deliberate V1 simplification
 * (documented in docs/decisions/0040) treats ANY refund (full or
 * partial) as a full reversal of that invoice's commission, rather than
 * prorating the commission to the refunded fraction. `markCommissionReversed`
 * only ever moves an `"accrued"` row to `"reversed"` — an already-`"paid"`
 * commission is a settled real-world payment Kyle already made, and a
 * refund arriving after that is a separate manual reconciliation
 * question for Kyle, never something this silently undoes.
 */
export async function processChargeRefunded(db: Queryable, charge: StripeChargeObject): Promise<void> {
  if (!charge.refunded && !(charge.amount_refunded > 0)) return;

  const commissions = await commissionsRepo.listCommissionsByStripeChargeId(db, charge.id);
  for (const commission of commissions) {
    await commissionsRepo.markCommissionReversed(db, commission.id);
  }
}
