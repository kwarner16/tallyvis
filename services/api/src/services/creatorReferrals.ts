import { isUniqueViolation } from "../db/pg/client";
import type { Queryable } from "../db/pg/client";
import * as creatorsRepo from "../repositories/creators";
import * as referralsRepo from "../repositories/creatorReferrals";
import type { CreatorReferral } from "../repositories/creatorReferrals";
import { getBusinessById } from "../repositories/businesses";

/**
 * TallyVis Founding Creator Program — referral click resolution and
 * durable attribution (see docs/decisions/0040-creator-affiliate-program.md).
 */

/**
 * Lowercase letters/digits/hyphens, 2-32 characters, never starting with
 * a hyphen — generous enough for any real creator handle while rejecting
 * obvious garbage/injection attempts before a single database query runs.
 * The same pattern `services/creators.ts`'s `validateSlugInput` enforces
 * when Kyle actually CREATES a slug — this is the read-side half of that
 * same contract, checked independently so a malformed value reaching this
 * function (e.g. a stale/tampered cookie) is rejected the same way a
 * malformed URL segment is.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidSlugFormat(raw: string): boolean {
  return SLUG_PATTERN.test(normalizeSlug(raw));
}

export interface ReferralResolution {
  creatorId: string;
  slug: string;
}

/**
 * Validates the slug's FORMAT first, before any database query — cheap
 * abuse protection against obviously-malformed input. Resolves to a
 * creator only when one exists for this slug AND that creator is
 * currently `"active"` — a `"paused"`/`"inactive"`/`"prospect"`/`"invited"`
 * creator's link must not start crediting referrals. The `/r/[slug]`
 * route treats every rejection reason (malformed, unknown, inactive)
 * identically — redirect onward with no cookie set — so none of them is
 * ever distinguishable to a visitor probing for valid slugs.
 */
export async function resolveEligibleCreatorBySlug(db: Queryable, rawSlug: string): Promise<ReferralResolution | undefined> {
  if (!isValidSlugFormat(rawSlug)) return undefined;
  const slug = normalizeSlug(rawSlug);
  const creator = await creatorsRepo.getCreatorBySlug(db, slug);
  if (!creator || creator.status !== "active") return undefined;
  return { creatorId: creator.id, slug: creator.slug };
}

/** A plain atomic counter bump — see the migration's own comment for why this isn't a per-click event log. */
export async function recordReferralClick(db: Queryable, creatorId: string): Promise<void> {
  await creatorsRepo.incrementCreatorClickCount(db, creatorId);
}

/** Decoded from the referral attribution cookie by the caller (apps/app) — see EstimatorContext.tsx's "injectable, pure logic" precedent for why decoding itself stays outside services/api (no `next/headers` dependency here). */
export interface PendingReferralAttribution {
  slug: string;
  firstObservedAt: string;
}

/**
 * Obvious self-referral prevention using only data this app already has
 * on hand at attribution time — see docs/decisions/0040's V1.1 addendum
 * "Self-referrals / abuse" section for why this is deliberately bounded
 * to two cheap, reliable checks rather than any fingerprinting or fraud
 * scoring:
 *
 *   1. The new business's own signup email exactly matches (case-
 *      insensitively) the creator's own program email — the creator
 *      signing up a business with the same email they gave TallyVis for
 *      the program itself.
 *   2. The new business IS the creator's own already-linked TallyVis
 *      business (`creators.business_id`) — relevant if that link was
 *      established before this particular signup somehow re-ran
 *      attribution; cheap to check even though it's an unlikely
 *      ordering in practice.
 *
 * Neither check can ever produce a false positive against a genuine,
 * unrelated referral (a real customer's email is extremely unlikely to
 * coincidentally equal the creator's own), and both together cost one
 * extra indexed lookup. A business that merely shares a last name,
 * company name, or domain with the creator is NOT flagged — that would
 * need the invasive heuristics this program explicitly avoids.
 */
async function isLikelySelfReferral(db: Queryable, creatorId: string, businessId: string): Promise<boolean> {
  const [creator, business] = await Promise.all([creatorsRepo.getCreatorById(db, creatorId), getBusinessById(db, businessId)]);
  if (!creator || !business) return false;
  if (creator.businessId === businessId) return true;
  return creator.email.trim().toLowerCase() === business.email.trim().toLowerCase();
}

const MAX_COOKIE_AGE_MS = 31 * 24 * 60 * 60 * 1000; // one day of slack beyond the 30-day cookie's own max-age

/** A `firstObservedAt` this implausible can only be a corrupted/tampered cookie, never a real click — clamped to "now" rather than trusted, since this value only ever affects DISPLAY (see `CreatorReferral.firstObservedAt`), never any monetary calculation (commission eligibility is computed from `commission_window_started_at`, stamped server-side at the first real payment — see `creatorCommissions.ts`). */
function plausibleFirstObservedAt(value: string, now: string): string {
  const parsed = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(parsed) || parsed > nowMs || parsed < nowMs - MAX_COOKIE_AGE_MS) return now;
  return value;
}

/**
 * Called exactly once, AFTER a brand-new business's row has already
 * committed (see `signUp`/`createAccountFromGoogle`'s own comments for
 * why only there, and only after commit) — the one place a
 * `creator_referrals` row is ever created. Independently re-validates
 * `pending.slug` resolves to a real, currently-active creator — never
 * trusts the cookie's mere presence, which could be stale (the creator
 * was since deactivated) or tampered. A conflicting concurrent attempt
 * (the `UNIQUE(business_id)` constraint — see the migration) is caught
 * and treated as an already-attributed no-op, never retried as an
 * overwrite; this is what makes "subsequent browsing/cookie changes must
 * not casually overwrite attribution" true by construction rather than
 * by caller discipline alone.
 *
 * Never throws for an ordinary "no attribution" outcome (no cookie,
 * malformed slug, inactive creator) — only a genuine, unexpected database
 * error propagates, and even that is caught defensively by every caller
 * (mirrors `notifyAdminOfNewSignup`'s identical contract) so a referral-
 * tracking problem can never fail account creation itself.
 */
export async function attributeReferral(
  db: Queryable,
  businessId: string,
  pending: PendingReferralAttribution | undefined,
): Promise<CreatorReferral | undefined> {
  if (!pending) return undefined;
  const resolution = await resolveEligibleCreatorBySlug(db, pending.slug);
  if (!resolution) return undefined;

  if (await isLikelySelfReferral(db, resolution.creatorId, businessId)) {
    console.warn(
      `[creatorReferrals] self-referral prevented: business "${businessId}" matches creator "${resolution.creatorId}"'s own identity.`,
    );
    return undefined;
  }

  const now = new Date().toISOString();
  const firstObservedAt = plausibleFirstObservedAt(pending.firstObservedAt, now);

  try {
    return await referralsRepo.createCreatorReferral(db, {
      creatorId: resolution.creatorId,
      businessId,
      firstObservedAt,
      signedUpAt: now,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return undefined;
    throw err;
  }
}
