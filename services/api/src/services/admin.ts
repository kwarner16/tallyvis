import { getPlan } from "@tallyvis/config";
import type { Business, Quote } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import type { AuthUser } from "../types";
import { isAdminSession } from "./auth";
import { getBusinessById } from "../repositories/businesses";
import { listUsersForBusiness } from "../repositories/users";
import {
  getSubscriptionByBusinessId,
  listAllSubscriptionsWithBusinessName,
  type Subscription,
  type SubscriptionStatus,
} from "../repositories/subscriptions";
import { getActivePricingConfiguration } from "../repositories/pricingConfigurations";
import { listQuotes as listQuotesForBusiness } from "../repositories/quotes";
import { listCustomers as listCustomersForBusiness } from "../repositories/customers";
import * as adminRepo from "../repositories/admin";
import type {
  AdminBusinessCounts,
  AdminBusinessListRow,
  AdminBusinessSortBy,
  AdminSortDirection,
  AdminQuoteCounts,
  AdminRecentEventRow,
} from "../repositories/admin";

/**
 * Business logic for the internal TallyVis CEO/Admin dashboard (see
 * docs/decisions/0035-admin-dashboard.md). Every exported function here
 * takes an `AuthSession` and independently re-verifies admin access
 * (`requireAdmin` below) before touching any cross-tenant data — this is
 * the SAME check `apps/app/src/lib/adminSession.ts`'s `requireAdminContext()`
 * already runs for every admin page, deliberately duplicated here so a
 * future admin Server Action/route that forgets to call
 * `requireAdminContext()` still cannot reach real data. Both checks read
 * `users.is_admin` fresh from the database (see `isAdminSession`), never a
 * cached or client-supplied flag.
 */

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

/**
 * True only when Stripe's raw status is actually KNOWN to be `past_due` —
 * see docs/decisions/0036-subscription-provider-status.md. A subscription
 * whose `providerStatus` hasn't been synced yet (`undefined` — a legacy
 * row from before that column existed, or one still waiting for its next
 * webhook/reconciliation) is deliberately NOT treated as past due: that
 * would be guessing a fact TallyVis doesn't actually have. It's instead
 * optimistically treated as clean/current, which also matches
 * `hasProductAccess`'s own long-standing behavior of granting access
 * unless there's a concrete reason not to.
 */
export function isSubscriptionPastDue(subscription: { status: SubscriptionStatus; providerStatus?: string }): boolean {
  return subscription.status === "active" && subscription.providerStatus === "past_due";
}

export interface MrrBreakdown {
  /** Clean, current Monthly Recurring Revenue: every `status === "active"` subscription that is NOT known to be past due, at its plan's authoritative `@tallyvis/config` price. */
  activeMrrCents: number;
  /**
   * Recurring value TallyVis is still contractually owed by subscriptions
   * Stripe currently reports as `past_due` — Stripe is still attempting
   * collection (Smart Retries) and the business still has product access
   * during this grace period (see `subscriptions.ts`'s `hasProductAccess`),
   * but this revenue has NOT actually been collected this period. Shown as
   * a separate "exposure" figure rather than folded into `activeMrrCents`
   * — the standard SaaS accounting treatment for delinquent-but-not-yet-
   * churned revenue (see docs/decisions/0036-subscription-provider-status.md's
   * "MRR" section).
   */
  pastDueMrrCents: number;
}

/**
 * What counts as Monthly Recurring Revenue, and why (see
 * docs/decisions/0036-subscription-provider-status.md's "MRR" section for
 * the full reasoning — this definition was revised from the one that
 * originally shipped with docs/decisions/0035-admin-dashboard.md, which
 * could not yet tell past-due subscriptions apart from current ones):
 *
 *   - Only `status === "active"` is ever counted at all. `trialing` is
 *     excluded — Stripe isn't charging the business anything yet.
 *     `canceled`/`expired`/`incomplete` are excluded — no revenue is being
 *     collected.
 *   - Within `"active"`, a subscription Stripe confirms is `past_due`
 *     (see `isSubscriptionPastDue`) contributes to `pastDueMrrCents`
 *     instead of `activeMrrCents` — it is real recurring revenue TallyVis
 *     is owed, but not currently clean/collected, so it is never silently
 *     folded into the headline "active" MRR figure.
 *   - The authoritative price is `@tallyvis/config`'s `PLANS` (the same
 *     single source of truth the checkout flow itself reads to create the
 *     Stripe Price) — not a value stored on the subscription row, since
 *     none exists; `subscriptions.plan_id` only ever stores which plan,
 *     never its price. This is the most reliable synchronized value
 *     available: Stripe's own invoice/subscription amount is NOT persisted
 *     anywhere in this schema, and there is no evidence the two would ever
 *     disagree for a plan-based subscription (no per-business custom
 *     pricing exists).
 *   - One-time charges (`billing_charges` — the $299 installation fee) are
 *     a completely separate table this function never reads, so they can
 *     never be counted as recurring revenue.
 *   - Each business contributes at most once — `subscriptions` has a
 *     `UNIQUE(business_id)` constraint, so there is no double-counting risk
 *     to guard against here.
 */
export function calculateMrrBreakdown(
  subscriptions: { status: SubscriptionStatus; planId: string; providerStatus?: string }[],
): MrrBreakdown {
  let activeMrrCents = 0;
  let pastDueMrrCents = 0;
  for (const subscription of subscriptions) {
    if (subscription.status !== "active") continue;
    const priceCents = getPlan(subscription.planId)?.monthlyPriceCents ?? 0;
    if (isSubscriptionPastDue(subscription)) {
      pastDueMrrCents += priceCents;
    } else {
      activeMrrCents += priceCents;
    }
  }
  return { activeMrrCents, pastDueMrrCents };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Buckets ISO-8601 timestamps into UTC calendar-day counts over a fixed trailing window — pure JS, no SQL date arithmetic (see repositories/admin.ts's header comment). Every day in the window is present in the output (zero-filled), even with no events, so a chart never has to guess at missing dates. */
function bucketByDay(timestamps: string[], days: number, now: Date): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    buckets.set(key, 0);
  }
  for (const timestamp of timestamps) {
    const key = timestamp.slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

/**
 * A strict partition of every subscription row into exactly one bucket —
 * `active` here specifically means "active and NOT past due" (see
 * `isSubscriptionPastDue`), so these six counts always sum to the total
 * number of subscription rows, with no overlap and nothing uncounted.
 */
export interface AdminSubscriptionStatusCounts {
  trialing: number;
  active: number;
  pastDue: number;
  canceled: number;
  expired: number;
  incomplete: number;
}

export interface AdminOverview {
  businesses: AdminBusinessCounts;
  subscriptions: AdminSubscriptionStatusCounts;
  mrr: MrrBreakdown;
  quotes: AdminQuoteCounts;
  totalCustomers: number;
  growth: {
    businessesByDay: { date: string; count: number }[];
    quotesByDay: { date: string; count: number }[];
  };
  recentActivity: AdminRecentEventRow[];
}

const GROWTH_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT_PER_KIND = 15;
const ACTIVITY_FEED_SIZE = 20;

export async function getAdminOverview(db: Queryable, session: AuthSession): Promise<AdminOverview> {
  await requireAdmin(db, session);

  const now = new Date();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const thirtyDaysAgoIso = new Date(now.getTime() - GROWTH_WINDOW_DAYS * DAY_MS).toISOString();

  const [businesses, quotes, totalCustomers, subscriptions, businessTimestamps, quoteTimestamps, recentActivityRaw] =
    await Promise.all([
      adminRepo.getBusinessCounts(db, sevenDaysAgoIso, thirtyDaysAgoIso),
      adminRepo.getQuoteCounts(db, sevenDaysAgoIso, thirtyDaysAgoIso),
      adminRepo.getCustomerCount(db),
      listAllSubscriptionsWithBusinessName(db),
      adminRepo.listBusinessCreatedAtSince(db, thirtyDaysAgoIso),
      adminRepo.listQuoteCreatedAtSince(db, thirtyDaysAgoIso),
      adminRepo.listRecentActivityEvents(db, ACTIVITY_LIMIT_PER_KIND),
    ]);

  const subscriptionCounts: AdminSubscriptionStatusCounts = {
    trialing: subscriptions.filter((s) => s.status === "trialing").length,
    active: subscriptions.filter((s) => s.status === "active" && !isSubscriptionPastDue(s)).length,
    pastDue: subscriptions.filter((s) => isSubscriptionPastDue(s)).length,
    canceled: subscriptions.filter((s) => s.status === "canceled").length,
    expired: subscriptions.filter((s) => s.status === "expired").length,
    incomplete: subscriptions.filter((s) => s.status === "incomplete").length,
  };

  const recentActivity = recentActivityRaw
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, ACTIVITY_FEED_SIZE);

  return {
    businesses,
    subscriptions: subscriptionCounts,
    mrr: calculateMrrBreakdown(subscriptions),
    quotes,
    totalCustomers,
    growth: {
      businessesByDay: bucketByDay(businessTimestamps, GROWTH_WINDOW_DAYS, now),
      quotesByDay: bucketByDay(quoteTimestamps, GROWTH_WINDOW_DAYS, now),
    },
    recentActivity,
  };
}

export interface AdminBusinessListResult {
  rows: AdminBusinessListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListBusinessesAdminInput {
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: AdminBusinessSortBy;
  sortDirection?: AdminSortDirection;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listBusinessesAdmin(
  db: Queryable,
  session: AuthSession,
  input: ListBusinessesAdminInput,
): Promise<AdminBusinessListResult> {
  await requireAdmin(db, session);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const sortBy = input.sortBy ?? "createdAt";
  const sortDirection = input.sortDirection ?? "desc";

  const [rows, total] = await Promise.all([
    adminRepo.listBusinessesForAdmin(db, {
      search: input.search,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortBy,
      sortDirection,
    }),
    adminRepo.countBusinessesForAdmin(db, input.search),
  ]);

  return { rows, total, page, pageSize };
}

export interface AdminBusinessDetail {
  business: Business;
  owner: AuthUser | undefined;
  subscription: Subscription | undefined;
  pricingConfigVersion: number | undefined;
  quoteCount: number;
  customerCount: number;
  acceptedCount: number;
  declinedCount: number;
  recentQuotes: Quote[];
}

const RECENT_QUOTES_LIMIT = 10;

export async function getBusinessDetailAdmin(
  db: Queryable,
  session: AuthSession,
  businessId: string,
): Promise<AdminBusinessDetail | undefined> {
  await requireAdmin(db, session);

  const business = await getBusinessById(db, businessId);
  if (!business) return undefined;

  const [users, subscription, pricingConfig, quotes, customers] = await Promise.all([
    listUsersForBusiness(db, businessId),
    getSubscriptionByBusinessId(db, businessId),
    getActivePricingConfiguration(db, businessId),
    listQuotesForBusiness(db, businessId),
    listCustomersForBusiness(db, businessId),
  ]);

  return {
    business,
    owner: users[0],
    subscription,
    pricingConfigVersion: pricingConfig?.version,
    quoteCount: quotes.length,
    customerCount: customers.length,
    acceptedCount: quotes.filter((q) => q.status === "accepted").length,
    declinedCount: quotes.filter((q) => q.status === "declined").length,
    recentQuotes: quotes.slice(0, RECENT_QUOTES_LIMIT),
  };
}

export interface AdminSubscriptionRow {
  businessId: string;
  businessName: string;
  planId: string;
  status: SubscriptionStatus;
  /** Stripe's raw status, if known yet — see `Subscription.providerStatus`'s own comment. */
  providerStatus?: string;
  isPastDue: boolean;
  /** This plan's authoritative monthly price, shown regardless of bucket — "what this subscription is worth," whether or not it's currently counted toward MRR. */
  recurringCents: number;
  /** Which `MrrBreakdown` bucket (if any) `recurringCents` currently counts toward. */
  mrrBucket: "active" | "past_due" | "none";
  trialUsedAt?: string;
  trialEndsAt?: string;
  createdAt: string;
  canceledAt?: string;
}

const FULL_ACTIVITY_LIMIT_PER_KIND = 40;
const FULL_ACTIVITY_FEED_SIZE = 75;

/** The full-page `/admin/activity` feed — same derivation as `getAdminOverview`'s embedded one, just with a larger window, fetched independently so that page doesn't have to pull the whole overview (counts, MRR, growth buckets) just to show more history. */
export async function listRecentActivityAdmin(db: Queryable, session: AuthSession): Promise<AdminRecentEventRow[]> {
  await requireAdmin(db, session);
  const events = await adminRepo.listRecentActivityEvents(db, FULL_ACTIVITY_LIMIT_PER_KIND);
  return events
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, FULL_ACTIVITY_FEED_SIZE);
}

export async function listSubscriptionsAdmin(db: Queryable, session: AuthSession): Promise<AdminSubscriptionRow[]> {
  await requireAdmin(db, session);

  const subscriptions = await listAllSubscriptionsWithBusinessName(db);
  return subscriptions
    .map((subscription) => {
      const pastDue = isSubscriptionPastDue(subscription);
      const mrrBucket: AdminSubscriptionRow["mrrBucket"] =
        subscription.status !== "active" ? "none" : pastDue ? "past_due" : "active";
      return {
        businessId: subscription.businessId,
        businessName: subscription.businessName,
        planId: subscription.planId,
        status: subscription.status,
        providerStatus: subscription.providerStatus,
        isPastDue: pastDue,
        recurringCents: getPlan(subscription.planId)?.monthlyPriceCents ?? 0,
        mrrBucket,
        trialUsedAt: subscription.trialUsedAt,
        trialEndsAt: subscription.trialEndsAt,
        createdAt: subscription.createdAt,
        canceledAt: subscription.canceledAt,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
