import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/** The durable "this business was referred by this creator" record — see db/pg/migrations/0015_creator_program.sql's own comment. */
export interface CreatorReferral {
  id: string;
  creatorId: string;
  businessId: string;
  firstObservedAt: string;
  signedUpAt: string;
  commissionWindowStartedAt?: string;
  createdAt: string;
}

interface CreatorReferralRow {
  id: string;
  creator_id: string;
  business_id: string;
  first_observed_at: string;
  signed_up_at: string;
  commission_window_started_at: string | null;
  created_at: string;
}

function toCreatorReferral(row: CreatorReferralRow): CreatorReferral {
  return {
    id: row.id,
    creatorId: row.creator_id,
    businessId: row.business_id,
    firstObservedAt: row.first_observed_at,
    signedUpAt: row.signed_up_at,
    commissionWindowStartedAt: row.commission_window_started_at ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateCreatorReferralInput {
  creatorId: string;
  businessId: string;
  firstObservedAt: string;
  signedUpAt: string;
}

/**
 * The one and only INSERT for this table — there is deliberately no
 * corresponding "update creatorId" function anywhere in this repo. The
 * `UNIQUE(business_id)` index (see the migration) is what actually
 * guarantees a business is attributed at most once, not just the absence
 * of a function that would change it; callers (`services/creatorReferrals.ts`)
 * must be prepared to catch a unique-violation here as "already
 * attributed, this attempt is a no-op," never retry it as an overwrite.
 */
export async function createCreatorReferral(db: Queryable, input: CreateCreatorReferralInput): Promise<CreatorReferral> {
  const id = makeId("referral");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creator_referrals (id, creator_id, business_id, first_observed_at, signed_up_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.creatorId, input.businessId, input.firstObservedAt, input.signedUpAt, now],
  );
  const created = await getCreatorReferralByBusinessId(db, input.businessId);
  if (!created) throw new Error("Failed to read back the referral that was just created.");
  return created;
}

export async function getCreatorReferralByBusinessId(db: Queryable, businessId: string): Promise<CreatorReferral | undefined> {
  const result = await db.query<CreatorReferralRow>(`SELECT * FROM creator_referrals WHERE business_id = $1`, [businessId]);
  const row = result.rows[0];
  return row ? toCreatorReferral(row) : undefined;
}

export async function listCreatorReferralsByCreatorId(db: Queryable, creatorId: string): Promise<CreatorReferral[]> {
  const result = await db.query<CreatorReferralRow>(
    `SELECT * FROM creator_referrals WHERE creator_id = $1 ORDER BY signed_up_at DESC`,
    [creatorId],
  );
  return result.rows.map(toCreatorReferral);
}

/** Stamped exactly once, the first time a commission-eligible invoice is actually processed for this referral (see services/creatorCommissions.ts) — a no-op if already set, enforced by the WHERE clause so a later call can never move an already-fixed window start. */
export async function startCommissionWindowIfUnset(
  db: Queryable,
  referralId: string,
  startedAt: string,
): Promise<void> {
  await db.query(
    `UPDATE creator_referrals SET commission_window_started_at = $1 WHERE id = $2 AND commission_window_started_at IS NULL`,
    [startedAt, referralId],
  );
}

export async function getCreatorReferralById(db: Queryable, id: string): Promise<CreatorReferral | undefined> {
  const result = await db.query<CreatorReferralRow>(`SELECT * FROM creator_referrals WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toCreatorReferral(row) : undefined;
}

/**
 * One row per referral, left-joined with that referral's business's
 * current subscription (if any) — the raw data `services/creators.ts`'s
 * admin list/metrics aggregate in JS, the same "fetch flat rows, reduce
 * in TypeScript" style `services/admin.ts`'s own dashboard metrics
 * already use (reusing that exact MRR/"active vs past-due" accounting
 * rather than inventing a second one for this feature — see
 * `isSubscriptionPastDue`/`calculateMrrBreakdown`). `status`/`planId` are
 * `null` when the referred business has never started a subscription at
 * all (a real, common state — a referred signup that hasn't paid yet).
 */
export interface ReferralSubscriptionRow {
  creatorId: string;
  businessId: string;
  businessName: string;
  status: string | null;
  providerStatus: string | null;
  planId: string | null;
  signedUpAt: string;
}

export async function listReferralSubscriptionRows(db: Queryable): Promise<ReferralSubscriptionRow[]> {
  const result = await db.query<{
    creator_id: string;
    business_id: string;
    business_name: string;
    status: string | null;
    provider_status: string | null;
    plan_id: string | null;
    signed_up_at: string;
  }>(
    `SELECT r.creator_id, r.business_id, b.name AS business_name, s.status, s.provider_status, s.plan_id, r.signed_up_at
     FROM creator_referrals r
     JOIN businesses b ON b.id = r.business_id
     LEFT JOIN subscriptions s ON s.business_id = r.business_id`,
  );
  return result.rows.map((row) => ({
    creatorId: row.creator_id,
    businessId: row.business_id,
    businessName: row.business_name,
    status: row.status,
    providerStatus: row.provider_status,
    planId: row.plan_id,
    signedUpAt: row.signed_up_at,
  }));
}
