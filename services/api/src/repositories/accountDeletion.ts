import type { Queryable } from "../db/pg/client";

/**
 * Deletes every row this business (and its users) own — enumerated
 * directly from the actual schema (grepped across every migration file,
 * see docs/decisions/0019-account-settings-and-google-auth.md), not a
 * hand-maintained list that could silently fall out of sync with a future
 * migration. Order matters: children before parents, so foreign-key
 * enforcement (always on in Postgres) never blocks a step.
 *
 * `password_reset_tokens`/`auth_identities` key off `user_id`, not
 * `business_id` directly, so those two use a subquery rather than a
 * simple equality match; `sessions` happens to also carry `business_id`
 * (a deliberate denormalization from Phase 9), so it doesn't need one.
 *
 * Callers are responsible for wrapping this in a transaction (`db` should
 * be a `withTransaction()` callback's `tx`, not the bare pool) and for any
 * Stripe-side cancellation that must happen BEFORE this runs — see
 * `services/accountDeletion.ts`, which is the only intended caller.
 */
export async function deleteAllBusinessData(db: Queryable, businessId: string): Promise<void> {
  await db.query(`DELETE FROM job_outcomes WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM quote_share_tokens WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM quotes WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM customers WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM pricing_configurations WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM billing_charges WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM subscriptions WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [businessId]);
  await db.query(`DELETE FROM auth_identities WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [businessId]);
  await db.query(`DELETE FROM sessions WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM users WHERE business_id = $1`, [businessId]);
  await db.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
}
