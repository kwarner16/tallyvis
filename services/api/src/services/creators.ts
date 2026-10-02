import { getPlan, CREATOR_PROGRAM_POLICY } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isUniqueViolation } from "../db/pg/client";
import { isAdminSession } from "./auth";
import { getBusinessById } from "../repositories/businesses";
import { isSubscriptionPastDue } from "./admin";
import * as creatorsRepo from "../repositories/creators";
import type { Creator, CreatorStatus } from "../repositories/creators";
import * as referralsRepo from "../repositories/creatorReferrals";
import * as commissionsRepo from "../repositories/creatorCommissions";
import type { CreatorCommission } from "../repositories/creatorCommissions";
import * as adjustmentsRepo from "../repositories/creatorCommissionAdjustments";
import type { CreatorCommissionAdjustment } from "../repositories/creatorCommissionAdjustments";
import { isValidSlugFormat, normalizeSlug } from "./creatorReferrals";

export type { Creator, CreatorStatus } from "../repositories/creators";
export type { CreatorReferral } from "../repositories/creatorReferrals";
export type { CreatorCommission, CreatorCommissionStatus } from "../repositories/creatorCommissions";
export type { CreatorCommissionAdjustment, CreatorCommissionAdjustmentReason } from "../repositories/creatorCommissionAdjustments";

/**
 * TallyVis Founding Creator Program — admin-side creator management and
 * reporting (see docs/decisions/0040-creator-affiliate-program.md and
 * its V1.1 addendum). Every exported function here independently
 * re-verifies admin access, the same `requireAdmin` pattern
 * `services/admin.ts`/`services/feedback.ts` already establish — never
 * inferred from navigation alone.
 */

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

const CREATOR_STATUSES: readonly CreatorStatus[] = ["prospect", "invited", "active", "paused", "inactive"];

function isCreatorStatus(value: string): value is CreatorStatus {
  return CREATOR_STATUSES.includes(value as CreatorStatus);
}

const NAME_MAX_LENGTH = 200;
const EMAIL_PATTERN = /\S+@\S+\.\S+/;
const NOTES_MAX_LENGTH = 4000;
const URL_MAX_LENGTH = 2000;
const MAX_COMMISSION_RATE_BPS = 10_000; // 100% — a sanity ceiling, not a business rule.
const MAX_COMMISSION_DURATION_MONTHS = 120; // 10 years — generous but bounded against a fat-fingered entry.

export interface CreateCreatorInput {
  slug: string;
  name: string;
  email: string;
  platform?: string;
  profileUrl?: string;
  status?: CreatorStatus;
  commissionRateBps?: number;
  commissionDurationMonths?: number;
  notes?: string;
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > NAME_MAX_LENGTH) {
    throw new Error("Please enter a valid creator name.");
  }
  return trimmed;
}

function validateEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new Error("Please enter a valid email address.");
  }
  return trimmed;
}

function validateCommissionRateBps(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COMMISSION_RATE_BPS) {
    throw new Error("Commission rate must be a whole number of basis points between 0 and 10000 (0%-100%).");
  }
  return value;
}

function validateCommissionDurationMonths(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_COMMISSION_DURATION_MONTHS) {
    throw new Error(`Commission duration must be between 1 and ${MAX_COMMISSION_DURATION_MONTHS} months.`);
  }
  return value;
}

/**
 * Creator slugs are immutable once created — see `UpdateCreatorInput`'s
 * own comment in repositories/creators.ts: a creator's referral link is
 * shared publicly and externally the moment Kyle hands it out, so there
 * is no "rename" operation anywhere in this file.
 */
export async function createCreatorAdmin(db: Queryable, session: AuthSession, input: CreateCreatorInput): Promise<Creator> {
  await requireAdmin(db, session);

  if (!isValidSlugFormat(input.slug)) {
    throw new Error(
      "Referral code must be 2-32 characters, lowercase letters/numbers/hyphens only, and can't start with a hyphen.",
    );
  }
  const slug = normalizeSlug(input.slug);
  const status = input.status && isCreatorStatus(input.status) ? input.status : "prospect";

  try {
    const creator = await creatorsRepo.createCreator(db, {
      slug,
      name: validateName(input.name),
      email: validateEmail(input.email),
      platform: input.platform?.trim() ?? "",
      profileUrl: input.profileUrl?.trim() ?? "",
      status,
      commissionRateBps: validateCommissionRateBps(input.commissionRateBps ?? CREATOR_PROGRAM_POLICY.defaultCommissionRateBps),
      commissionDurationMonths: validateCommissionDurationMonths(
        input.commissionDurationMonths ?? CREATOR_PROGRAM_POLICY.defaultCommissionDurationMonths,
      ),
      notes: (input.notes ?? "").slice(0, NOTES_MAX_LENGTH),
    });
    // A creator can be created already-active (e.g. backfilling a
    // relationship that started before this admin UI existed) — stamp
    // activation immediately in that case too, same as a later status
    // transition would. See `stampActivationIfNeeded`'s own comment.
    return status === "active" ? await stampActivationIfNeeded(db, creator) : creator;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(`The referral code "${slug}" is already taken.`);
    }
    throw err;
  }
}

/**
 * Stamps `activatedAt` the FIRST time a creator's status becomes
 * `"active"` — never moved again afterward, even across a later
 * pause/reactivate cycle (see docs/decisions/0040's V1.1 addendum
 * "First/partial month" section: re-activating an existing creator does
 * NOT reset their activity-requirement clock or grant a second
 * onboarding month). `updateCreator`'s own `COALESCE(activated_at, ...)`
 * is the actual guarantee; this helper just decides WHEN to pass a
 * value at all; the caller must have already confirmed `status` is
 * being set to `"active"`.
 */
async function stampActivationIfNeeded(db: Queryable, creator: Creator): Promise<Creator> {
  if (creator.activatedAt) return creator;
  const updated = await creatorsRepo.updateCreator(db, creator.id, { activatedAt: new Date().toISOString() });
  return updated ?? creator;
}

export interface UpdateCreatorAdminInput {
  name?: string;
  email?: string;
  platform?: string;
  profileUrl?: string;
  status?: CreatorStatus;
  commissionRateBps?: number;
  commissionDurationMonths?: number;
  notes?: string;
}

export async function updateCreatorAdmin(
  db: Queryable,
  session: AuthSession,
  id: string,
  input: UpdateCreatorAdminInput,
): Promise<Creator> {
  await requireAdmin(db, session);

  if (input.status !== undefined && !isCreatorStatus(input.status)) {
    throw new Error(`Unknown creator status "${input.status}".`);
  }

  const updated = await creatorsRepo.updateCreator(db, id, {
    name: input.name !== undefined ? validateName(input.name) : undefined,
    email: input.email !== undefined ? validateEmail(input.email) : undefined,
    platform: input.platform?.trim(),
    profileUrl: input.profileUrl?.trim(),
    status: input.status,
    commissionRateBps: input.commissionRateBps !== undefined ? validateCommissionRateBps(input.commissionRateBps) : undefined,
    commissionDurationMonths:
      input.commissionDurationMonths !== undefined ? validateCommissionDurationMonths(input.commissionDurationMonths) : undefined,
    notes: input.notes !== undefined ? input.notes.slice(0, NOTES_MAX_LENGTH) : undefined,
  });
  if (!updated) throw new Error(`Creator "${id}" not found.`);

  // See `stampActivationIfNeeded`'s own comment — applies here too,
  // whenever an UPDATE (not just creation) is what moves a creator into
  // `"active"` for the first time.
  return input.status === "active" ? await stampActivationIfNeeded(db, updated) : updated;
}

/**
 * Manual, admin-entered record of a creator's most recent qualifying
 * content — see docs/decisions/0040's V1.1 addendum "Active Creator
 * definition" section. TallyVis does not, and does not claim to,
 * automatically verify content publication; this is purely a
 * lightweight note Kyle records himself after actually checking. Each
 * call REPLACES the previous entry (no history of every past one — see
 * `recordCreatorActivity`'s own comment).
 */
export interface RecordCreatorActivityInput {
  contentAt: string;
  contentUrl: string;
  note?: string;
}

export async function recordCreatorActivityAdmin(
  db: Queryable,
  session: AuthSession,
  creatorId: string,
  input: RecordCreatorActivityInput,
): Promise<Creator> {
  await requireAdmin(db, session);

  const contentAt = input.contentAt.trim();
  if (!contentAt || Number.isNaN(Date.parse(contentAt))) {
    throw new Error("Please enter a valid content date.");
  }
  const contentUrl = input.contentUrl.trim();
  if (!contentUrl || contentUrl.length > URL_MAX_LENGTH) {
    throw new Error("Please enter the content URL.");
  }

  const updated = await creatorsRepo.recordCreatorActivity(db, creatorId, {
    contentAt: new Date(contentAt).toISOString(),
    contentUrl,
    note: (input.note ?? "").slice(0, NOTES_MAX_LENGTH),
  });
  if (!updated) throw new Error(`Creator "${creatorId}" not found.`);
  return updated;
}

/**
 * The first calendar month this creator is expected to have posted at
 * least one qualifying content piece — see docs/decisions/0040's V1.1
 * addendum "First/partial month" section: the calendar month a creator
 * is ACTIVATED in is a no-requirement onboarding month (so joining on
 * the 28th never immediately counts as inactive), and the requirement
 * begins with the first FULL calendar month after that. `undefined` when
 * the creator has never been activated at all (nothing to measure from
 * yet). UTC-based, matching this file's other date arithmetic.
 */
export function firstActivityMonthStart(activatedAt: string | undefined): string | undefined {
  if (!activatedAt) return undefined;
  const date = new Date(activatedAt);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * Whether an accrued commission has cleared the payout holding period
 * (see `CREATOR_PROGRAM_POLICY.payoutHoldingPeriodDays`'s own comment
 * for why this is a plain computed-at-read-time check, never a stored
 * status/background job) — `"payable"` vs merely `"pending"` in the
 * admin dashboard. A `'paid'`/`'reversed'` commission is neither — this
 * only ever returns true for a still-`'accrued'` row.
 */
export function isCommissionPayable(commission: { status: string; createdAt: string }, now: number = Date.now()): boolean {
  if (commission.status !== "accrued") return false;
  const holdingMs = CREATOR_PROGRAM_POLICY.payoutHoldingPeriodDays * 24 * 60 * 60 * 1000;
  return now - Date.parse(commission.createdAt) >= holdingMs;
}

/**
 * Links (or, with `businessId: null`, unlinks) a creator to one of their
 * own TallyVis businesses — the prerequisite for the "free founding-
 * creator access" grant below. Validates the target business actually
 * exists and isn't already linked to a DIFFERENT creator (the
 * `UNIQUE(business_id)` partial index is the real guarantee — this is
 * just the friendly error for the common case). Unlinking always clears
 * `complimentaryAccess` too (see `clearCreatorBusinessLink`'s own
 * comment) — a grant with no business to apply it to is meaningless.
 */
export async function linkCreatorBusinessAdmin(
  db: Queryable,
  session: AuthSession,
  creatorId: string,
  businessId: string | null,
): Promise<Creator> {
  await requireAdmin(db, session);

  if (businessId === null) {
    const updated = await creatorsRepo.clearCreatorBusinessLink(db, creatorId);
    if (!updated) throw new Error(`Creator "${creatorId}" not found.`);
    return updated;
  }

  const business = await getBusinessById(db, businessId);
  if (!business) throw new Error(`Business "${businessId}" not found.`);

  try {
    const updated = await creatorsRepo.updateCreator(db, creatorId, { businessId });
    if (!updated) throw new Error(`Creator "${creatorId}" not found.`);
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error("That business is already linked to a different creator.");
    }
    throw err;
  }
}

/**
 * The "free founding-creator access" grant — see
 * docs/decisions/0040-creator-affiliate-program.md's "Free creator
 * access" section for why this is a plain boolean on `creators`, checked
 * as an early-return in `services/quotes.ts`'s entitlement gate, rather
 * than any kind of fabricated Stripe subscription. Refuses outright if
 * this creator has no linked business yet — there's nothing to grant
 * access to.
 */
export async function setCreatorComplimentaryAccessAdmin(
  db: Queryable,
  session: AuthSession,
  creatorId: string,
  enabled: boolean,
): Promise<Creator> {
  await requireAdmin(db, session);

  const creator = await creatorsRepo.getCreatorById(db, creatorId);
  if (!creator) throw new Error(`Creator "${creatorId}" not found.`);
  if (enabled && !creator.businessId) {
    throw new Error("Link this creator to a TallyVis business before granting complimentary access.");
  }

  const updated = await creatorsRepo.updateCreator(db, creatorId, { complimentaryAccess: enabled });
  if (!updated) throw new Error(`Creator "${creatorId}" not found.`);
  return updated;
}

/** True only when an ACTIVE creator has complimentary access explicitly granted for this exact business — see `linkCreatorBusinessAdmin`/`setCreatorComplimentaryAccessAdmin` above for the only two ways this can become true. Deliberately requires `status === "active"` too: pausing/deactivating a creator immediately suspends any complimentary access tied to them, with no separate step to remember. */
export async function hasComplimentaryAccess(db: Queryable, businessId: string): Promise<boolean> {
  const creator = await creatorsRepo.getCreatorByBusinessId(db, businessId);
  return Boolean(creator && creator.complimentaryAccess && creator.status === "active");
}

/**
 * Per-creator financial totals, reduced in TypeScript from the flat
 * per-commission/per-adjustment rows (the same "fetch flat rows,
 * aggregate in JS" pattern `services/admin.ts`'s own dashboard metrics
 * already use) — see `isCommissionPayable`'s own comment for why the
 * pending/payable split specifically needs row-level `createdAt`, not
 * just a SQL-side SUM.
 */
interface CreatorFinancials {
  pendingCommissionCents: number;
  payableCommissionCents: number;
  paidCommissionCents: number;
  reversedCommissionCents: number;
  adjustmentCents: number;
}

function summarizeCreatorFinancials(
  commissions: CreatorCommission[],
  adjustmentCents: number,
  now: number = Date.now(),
): CreatorFinancials {
  let pendingCommissionCents = 0;
  let payableCommissionCents = 0;
  let paidCommissionCents = 0;
  let reversedCommissionCents = 0;

  for (const commission of commissions) {
    const netCents = commission.commissionAmountCents - commission.reversedCommissionCents;
    if (commission.status === "accrued") {
      if (isCommissionPayable(commission, now)) payableCommissionCents += netCents;
      else pendingCommissionCents += netCents;
    } else if (commission.status === "paid") {
      paidCommissionCents += commission.commissionAmountCents;
    } else {
      reversedCommissionCents += commission.commissionAmountCents;
    }
  }

  return { pendingCommissionCents, payableCommissionCents, paidCommissionCents, reversedCommissionCents, adjustmentCents };
}

/**
 * Per-creator metrics for the admin list view — reuses
 * `services/admin.ts`'s own `isSubscriptionPastDue`/`@tallyvis/config`'s
 * `getPlan` for "is this subscription actually active/paying" and "what
 * is it worth," the exact same accounting the platform-wide admin
 * overview already uses, rather than inventing a second definition of
 * "paying"/MRR for this feature.
 */
export interface CreatorAdminListRow {
  id: string;
  slug: string;
  name: string;
  platform: string;
  status: CreatorStatus;
  commissionRateBps: number;
  clickCount: number;
  signupCount: number;
  payingCount: number;
  mrrCents: number;
  pendingCommissionCents: number;
  payableCommissionCents: number;
  paidCommissionCents: number;
  adjustmentCents: number;
}

export interface CreatorProgramOverview {
  activeCreators: number;
  totalClicks: number;
  totalSignups: number;
  totalPaying: number;
  totalMrrCents: number;
  totalPendingCommissionCents: number;
  totalPayableCommissionCents: number;
  totalPaidCommissionCents: number;
  totalAdjustmentCents: number;
}

export interface CreatorAdminListResult {
  rows: CreatorAdminListRow[];
  overview: CreatorProgramOverview;
}

export async function listCreatorsAdmin(db: Queryable, session: AuthSession): Promise<CreatorAdminListResult> {
  await requireAdmin(db, session);

  const [creators, referralRows, allCommissions, adjustmentTotals] = await Promise.all([
    creatorsRepo.listCreators(db),
    referralsRepo.listReferralSubscriptionRows(db),
    commissionsRepo.listAllCommissions(db),
    adjustmentsRepo.listAdjustmentTotalsByCreator(db),
  ]);

  const adjustmentByCreator = new Map(adjustmentTotals.map((row) => [row.creatorId, row.adjustmentCents]));
  const now = Date.now();

  const rows: CreatorAdminListRow[] = creators.map((creator) => {
    const referrals = referralRows.filter((row) => row.creatorId === creator.id);
    let payingCount = 0;
    let mrrCents = 0;
    for (const referral of referrals) {
      if (!referral.status || referral.status !== "active") continue;
      const pastDue = isSubscriptionPastDue({ status: "active", providerStatus: referral.providerStatus ?? undefined });
      if (pastDue) continue; // Counted platform-wide as "past due," not clean paying MRR — see admin.ts's own MRR definition.
      payingCount += 1;
      mrrCents += referral.planId ? getPlan(referral.planId)?.monthlyPriceCents ?? 0 : 0;
    }

    const creatorCommissions = allCommissions.filter((c) => c.creatorId === creator.id);
    const financials = summarizeCreatorFinancials(creatorCommissions, adjustmentByCreator.get(creator.id) ?? 0, now);

    return {
      id: creator.id,
      slug: creator.slug,
      name: creator.name,
      platform: creator.platform,
      status: creator.status,
      commissionRateBps: creator.commissionRateBps,
      clickCount: creator.clickCount,
      signupCount: referrals.length,
      payingCount,
      mrrCents,
      pendingCommissionCents: financials.pendingCommissionCents,
      payableCommissionCents: financials.payableCommissionCents,
      paidCommissionCents: financials.paidCommissionCents,
      adjustmentCents: financials.adjustmentCents,
    };
  });

  const overview: CreatorProgramOverview = rows.reduce(
    (acc, row) => ({
      activeCreators: acc.activeCreators + (row.status === "active" ? 1 : 0),
      totalClicks: acc.totalClicks + row.clickCount,
      totalSignups: acc.totalSignups + row.signupCount,
      totalPaying: acc.totalPaying + row.payingCount,
      totalMrrCents: acc.totalMrrCents + row.mrrCents,
      totalPendingCommissionCents: acc.totalPendingCommissionCents + row.pendingCommissionCents,
      totalPayableCommissionCents: acc.totalPayableCommissionCents + row.payableCommissionCents,
      totalPaidCommissionCents: acc.totalPaidCommissionCents + row.paidCommissionCents,
      totalAdjustmentCents: acc.totalAdjustmentCents + row.adjustmentCents,
    }),
    {
      activeCreators: 0,
      totalClicks: 0,
      totalSignups: 0,
      totalPaying: 0,
      totalMrrCents: 0,
      totalPendingCommissionCents: 0,
      totalPayableCommissionCents: 0,
      totalPaidCommissionCents: 0,
      totalAdjustmentCents: 0,
    },
  );

  return { rows, overview };
}

export interface CreatorReferralDetailRow {
  businessId: string;
  businessName: string;
  signedUpAt: string;
  subscriptionStatus?: string;
  planId?: string;
}

export interface CreatorAdminDetail {
  creator: Creator;
  /** `undefined` when the creator has never been activated — see `firstActivityMonthStart`'s own comment. */
  firstActivityMonthRequiredFrom?: string;
  referrals: CreatorReferralDetailRow[];
  commissions: CreatorCommission[];
  adjustments: CreatorCommissionAdjustment[];
  financials: CreatorFinancials;
}

export async function getCreatorDetailAdmin(db: Queryable, session: AuthSession, id: string): Promise<CreatorAdminDetail | undefined> {
  await requireAdmin(db, session);

  const creator = await creatorsRepo.getCreatorById(db, id);
  if (!creator) return undefined;

  const [allReferralRows, commissions, adjustments] = await Promise.all([
    referralsRepo.listReferralSubscriptionRows(db),
    commissionsRepo.listCommissionsByCreatorId(db, id),
    adjustmentsRepo.listAdjustmentsByCreatorId(db, id),
  ]);

  const referrals: CreatorReferralDetailRow[] = allReferralRows
    .filter((row) => row.creatorId === id)
    .map((row) => ({
      businessId: row.businessId,
      businessName: row.businessName,
      signedUpAt: row.signedUpAt,
      subscriptionStatus: row.status ?? undefined,
      planId: row.planId ?? undefined,
    }));

  const adjustmentCents = adjustments.reduce((sum, a) => sum + a.amountCents, 0);
  const financials = summarizeCreatorFinancials(commissions, adjustmentCents);

  return {
    creator,
    firstActivityMonthRequiredFrom: firstActivityMonthStart(creator.activatedAt),
    referrals,
    commissions,
    adjustments,
    financials,
  };
}

/**
 * Manual payout marking (see docs/decisions/0040's "Manual payout
 * process" section — V1.1 deliberately has no automated payout rail).
 * Only ever moves an `"accrued"` commission to `"paid"` — see
 * `markCommissionPaid`'s own comment for why an already-settled or
 * fully-reversed row refuses rather than silently re-stamping. Kyle may
 * mark a PARTIALLY-reversed commission paid — the amount recorded is
 * always the commission's own `commissionAmountCents` net of whatever
 * was already reversed; this function does not independently recompute
 * or second-guess that, it only changes lifecycle status.
 */
export async function markCommissionPaidAdmin(
  db: Queryable,
  session: AuthSession,
  commissionId: string,
  payoutNote: string | undefined,
): Promise<CreatorCommission> {
  await requireAdmin(db, session);
  const updated = await commissionsRepo.markCommissionPaid(db, commissionId, payoutNote?.trim() || undefined);
  if (!updated) {
    throw new Error("This commission was not found, or has already been paid/reversed.");
  }
  return updated;
}
