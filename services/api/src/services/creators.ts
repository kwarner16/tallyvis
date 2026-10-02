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
import { isValidSlugFormat, normalizeSlug } from "./creatorReferrals";

export type { Creator, CreatorStatus } from "../repositories/creators";
export type { CreatorReferral } from "../repositories/creatorReferrals";
export type { CreatorCommission, CreatorCommissionStatus } from "../repositories/creatorCommissions";

/**
 * TallyVis Founding Creator Program — admin-side creator management and
 * reporting (see docs/decisions/0040-creator-affiliate-program.md). Every
 * exported function here independently re-verifies admin access, the
 * same `requireAdmin` pattern `services/admin.ts`/`services/feedback.ts`
 * already establish — never inferred from navigation alone.
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

  try {
    return await creatorsRepo.createCreator(db, {
      slug,
      name: validateName(input.name),
      email: validateEmail(input.email),
      platform: input.platform?.trim() ?? "",
      profileUrl: input.profileUrl?.trim() ?? "",
      status: input.status && isCreatorStatus(input.status) ? input.status : "prospect",
      commissionRateBps: validateCommissionRateBps(input.commissionRateBps ?? CREATOR_PROGRAM_POLICY.defaultCommissionRateBps),
      commissionDurationMonths: validateCommissionDurationMonths(
        input.commissionDurationMonths ?? CREATOR_PROGRAM_POLICY.defaultCommissionDurationMonths,
      ),
      notes: (input.notes ?? "").slice(0, NOTES_MAX_LENGTH),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(`The referral code "${slug}" is already taken.`);
    }
    throw err;
  }
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
  return updated;
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
  commissionEarnedCents: number;
  commissionUnpaidCents: number;
  commissionPaidCents: number;
}

export interface CreatorProgramOverview {
  activeCreators: number;
  totalClicks: number;
  totalSignups: number;
  totalPaying: number;
  totalMrrCents: number;
  totalCommissionEarnedCents: number;
  totalCommissionUnpaidCents: number;
  totalCommissionPaidCents: number;
}

export interface CreatorAdminListResult {
  rows: CreatorAdminListRow[];
  overview: CreatorProgramOverview;
}

export async function listCreatorsAdmin(db: Queryable, session: AuthSession): Promise<CreatorAdminListResult> {
  await requireAdmin(db, session);

  const [creators, referralRows, commissionTotals] = await Promise.all([
    creatorsRepo.listCreators(db),
    referralsRepo.listReferralSubscriptionRows(db),
    commissionsRepo.listCommissionTotalsByCreator(db),
  ]);

  const commissionByCreator = new Map(commissionTotals.map((row) => [row.creatorId, row]));

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

    const commission = commissionByCreator.get(creator.id);
    const accruedCents = commission?.accruedCents ?? 0;
    const paidCents = commission?.paidCents ?? 0;

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
      commissionEarnedCents: accruedCents + paidCents,
      commissionUnpaidCents: accruedCents,
      commissionPaidCents: paidCents,
    };
  });

  const overview: CreatorProgramOverview = rows.reduce(
    (acc, row) => ({
      activeCreators: acc.activeCreators + (row.status === "active" ? 1 : 0),
      totalClicks: acc.totalClicks + row.clickCount,
      totalSignups: acc.totalSignups + row.signupCount,
      totalPaying: acc.totalPaying + row.payingCount,
      totalMrrCents: acc.totalMrrCents + row.mrrCents,
      totalCommissionEarnedCents: acc.totalCommissionEarnedCents + row.commissionEarnedCents,
      totalCommissionUnpaidCents: acc.totalCommissionUnpaidCents + row.commissionUnpaidCents,
      totalCommissionPaidCents: acc.totalCommissionPaidCents + row.commissionPaidCents,
    }),
    {
      activeCreators: 0,
      totalClicks: 0,
      totalSignups: 0,
      totalPaying: 0,
      totalMrrCents: 0,
      totalCommissionEarnedCents: 0,
      totalCommissionUnpaidCents: 0,
      totalCommissionPaidCents: 0,
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
  referrals: CreatorReferralDetailRow[];
  commissions: CreatorCommission[];
}

export async function getCreatorDetailAdmin(db: Queryable, session: AuthSession, id: string): Promise<CreatorAdminDetail | undefined> {
  await requireAdmin(db, session);

  const creator = await creatorsRepo.getCreatorById(db, id);
  if (!creator) return undefined;

  const [allReferralRows, commissions] = await Promise.all([
    referralsRepo.listReferralSubscriptionRows(db),
    commissionsRepo.listCommissionsByCreatorId(db, id),
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

  return { creator, referrals, commissions };
}

/**
 * Manual payout marking (see docs/decisions/0040's "Manual payout
 * process" section — V1 deliberately has no automated payout rail). Only
 * ever moves an `"accrued"` commission to `"paid"` — see
 * `markCommissionPaid`'s own comment for why an already-settled or
 * refunded row refuses rather than silently re-stamping.
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
