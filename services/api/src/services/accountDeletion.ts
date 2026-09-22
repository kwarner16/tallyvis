import type { DatabaseSync } from "node:sqlite";
import type { AuthSession } from "../auth/session";
import { revokeAllSessionsForUser } from "../auth/session";
import { getSubscriptionByBusinessId } from "../repositories/subscriptions";
import { deleteAllBusinessData } from "../repositories/accountDeletion";
import { cancelSubscriptionImmediately } from "../billing";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Deletion and
 * subscription cancellation are deliberately separate concepts —
 * `chooseSelfInstall`-style "just delete the local record" is NOT safe
 * here, since a real Stripe subscription would otherwise keep billing a
 * business owner with no Tallyvis account left to grant access to.
 */
export class AccountDeletionError extends Error {}

/** Best-effort, single-process guard against a double-submitted deletion request — the same documented-limitation pattern `subscriptions.ts`'s checkout guard uses. */
const inFlightDeletions = new Set<string>();

/**
 * 1. Resolves this business's Stripe subscription, if any.
 * 2. If it's real and not already canceled, cancels it IMMEDIATELY via
 *    Stripe (never "at period end" — there will be no account left to
 *    honor a grace period) — and does NOT delete the Stripe Customer
 *    itself, since Stripe's own payment/accounting records may need to
 *    remain there independent of whether the Tallyvis account exists.
 * 3. Only once Stripe confirms the cancellation does this delete/anonymize
 *    local data, transactionally. If Stripe cancellation fails, throws
 *    `AccountDeletionError` and the account is NOT touched — a safe,
 *    recoverable failure rather than a silent partial deletion.
 * 4. Revokes every session for this user as a final, explicit step (in
 *    addition to `deleteAllBusinessData` already deleting the session
 *    rows) so a caller can immediately clear the current request's own
 *    cookie/redirect without needing to re-derive anything from now-gone
 *    data.
 */
export async function deleteAccount(db: DatabaseSync, session: AuthSession): Promise<void> {
  if (inFlightDeletions.has(session.businessId)) {
    throw new AccountDeletionError("A deletion request is already in progress for this account.");
  }
  inFlightDeletions.add(session.businessId);

  try {
    const subscription = getSubscriptionByBusinessId(db, session.businessId);

    if (subscription?.providerSubscriptionId && subscription.status !== "canceled") {
      try {
        await cancelSubscriptionImmediately(subscription.providerSubscriptionId);
      } catch (err) {
        console.error("deleteAccount: Stripe cancellation failed, local deletion aborted:", err);
        throw new AccountDeletionError(
          "We couldn't cancel your subscription with Stripe, so your account was NOT deleted. Please try again in a moment, or contact support.",
        );
      }
    }

    db.exec("BEGIN");
    try {
      deleteAllBusinessData(db, session.businessId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("deleteAccount: local deletion failed:", err);
      throw new AccountDeletionError("Could not delete your account. Please try again or contact support.");
    }

    revokeAllSessionsForUser(db, session.userId);
  } finally {
    inFlightDeletions.delete(session.businessId);
  }
}
