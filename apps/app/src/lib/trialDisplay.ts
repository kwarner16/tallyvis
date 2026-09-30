import { getTrialDaysForNewSubscription } from "@tallyvis/config";

/**
 * The trial length a given subscription actually received, derived from its
 * own stored `trialStartedAt`/`trialEndsAt` rather than the current
 * promotional policy. The policy in `packages/config/src/trial.ts` only
 * governs new subscriptions going forward — a business that started during
 * the 30-day promo must keep seeing "of 30" in its own billing copy even
 * after the promotion has since ended for everyone else, and a business that
 * started before/after the promo must never have its history relabeled.
 */
export function grantedTrialDays(trialStartedAt: string | undefined, trialEndsAt: string): number {
  if (!trialStartedAt) return getTrialDaysForNewSubscription();
  const days = Math.round(
    (new Date(trialEndsAt).getTime() - new Date(trialStartedAt).getTime()) / (24 * 60 * 60 * 1000),
  );
  return days > 0 ? days : getTrialDaysForNewSubscription();
}
