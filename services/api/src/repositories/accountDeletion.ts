import type { DatabaseSync } from "node:sqlite";

/**
 * Deletes every row this business (and its users) own — enumerated
 * directly from the actual schema (grepped across every migration file,
 * see docs/decisions/0019-account-settings-and-google-auth.md), not a
 * hand-maintained list that could silently fall out of sync with a future
 * migration. Order matters: children before parents, so
 * `PRAGMA foreign_keys = ON` never blocks a step.
 *
 * `password_reset_tokens`/`auth_identities` key off `user_id`, not
 * `business_id` directly, so those two use a subquery rather than a
 * simple equality match; `sessions` happens to also carry `business_id`
 * (a deliberate denormalization from Phase 9), so it doesn't need one.
 *
 * Callers are responsible for wrapping this in a transaction and for any
 * Stripe-side cancellation that must happen BEFORE this runs — see
 * `services/accountDeletion.ts`, which is the only intended caller.
 */
export function deleteAllBusinessData(db: DatabaseSync, businessId: string): void {
  db.prepare(`DELETE FROM job_outcomes WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM quote_share_tokens WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM quotes WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM customers WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM pricing_configurations WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM billing_charges WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM subscriptions WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE business_id = ?)`).run(businessId);
  db.prepare(`DELETE FROM auth_identities WHERE user_id IN (SELECT id FROM users WHERE business_id = ?)`).run(businessId);
  db.prepare(`DELETE FROM sessions WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM users WHERE business_id = ?`).run(businessId);
  db.prepare(`DELETE FROM businesses WHERE id = ?`).run(businessId);
}
