/**
 * The single authoritative trial-length policy for new subscriptions.
 *
 * Kyle is running a promotional 30-day trial (instead of the normal 7-day
 * trial) for every subscription that starts through December 31, 2026, to
 * support the initial sales push. This is the one place that promotion is
 * defined — nowhere else in the repo should hard-code "30" or a 2026/2027
 * date; every trial-length decision point and every piece of copy that
 * states a trial length reads it from here (see
 * `getTrialDaysForNewSubscription` below).
 *
 * `promoEndsAtUtc` is an *exclusive* upper bound: a subscription started at
 * any instant strictly before this timestamp qualifies for the promo, so a
 * subscription started on December 31, 2026 at 23:59:59.999 UTC still gets
 * 30 days, and one started at 2027-01-01T00:00:00.000Z or later gets the
 * normal `defaultTrialDays`. Comparisons are deliberately UTC-based (not
 * server-local time) so the boundary is unambiguous regardless of where the
 * app is deployed.
 *
 * This only affects the trial length passed to Stripe when a *new* Checkout
 * session is created (see `services/api/src/services/subscriptions.ts`'s
 * `createCheckoutSessionForPlan`). Stripe locks in `trial_end` at that
 * moment, so changing this policy — including manually shortening the
 * promotion before December 31, 2026 by editing `promoEndsAtUtc` — never
 * retroactively mutates an already-created subscription.
 */
export const TRIAL_POLICY = {
  promoTrialDays: 30,
  promoEndsAtUtc: "2027-01-01T00:00:00.000Z",
  defaultTrialDays: 7,
} as const;

/** The normal, non-promotional trial length — what every subscription gets once the promotion above has ended. */
export const TRIAL_DAYS = TRIAL_POLICY.defaultTrialDays;

/**
 * The trial length (in days) a new subscription started at `now` should
 * receive. Pass an explicit `now` in tests to exercise both sides of the
 * promotion boundary; production call sites should omit it.
 */
export function getTrialDaysForNewSubscription(now: Date = new Date()): number {
  return now.getTime() < Date.parse(TRIAL_POLICY.promoEndsAtUtc)
    ? TRIAL_POLICY.promoTrialDays
    : TRIAL_POLICY.defaultTrialDays;
}
