import type { Queryable } from "../db/pg/client";

/**
 * The internal TallyVis CEO/Admin dashboard's raw SQL (see
 * docs/decisions/0035-admin-dashboard.md). Every function here is
 * deliberately NOT scoped by a single `businessId` — reading across every
 * tenant is the entire point of this file — so nothing in it may be
 * imported from anywhere except `services/admin.ts`, which independently
 * verifies the caller is an authenticated admin (`isAdminSession`) before
 * ever calling into here. No other service file, and no apps/app code,
 * should import from this file directly.
 *
 * Timestamp comparisons below (`WHERE created_at >= $1`) compare two
 * `new Date().toISOString()` TEXT values directly — fixed-width, UTC,
 * zero-padded, so a plain string `>=` sorts identically to chronological
 * order. This is a plain string comparison, not SQL-side date arithmetic
 * (no `datetime()`/`julianday()`/`strftime()`), so it doesn't conflict
 * with docs/decisions/0021-postgres-migration.md's reason for keeping
 * these columns as TEXT — the cutoff itself is always computed in JS
 * (`new Date(...).toISOString()`), never by the database.
 */

export interface AdminBusinessCounts {
  total: number;
  last7Days: number;
  last30Days: number;
}

export async function getBusinessCounts(
  db: Queryable,
  sevenDaysAgoIso: string,
  thirtyDaysAgoIso: string,
): Promise<AdminBusinessCounts> {
  const result = await db.query<{ total: string; last_7_days: string; last_30_days: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE created_at >= $1) AS last_7_days,
       COUNT(*) FILTER (WHERE created_at >= $2) AS last_30_days
     FROM businesses`,
    [sevenDaysAgoIso, thirtyDaysAgoIso],
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    last7Days: Number(row?.last_7_days ?? 0),
    last30Days: Number(row?.last_30_days ?? 0),
  };
}

export interface AdminQuoteCounts {
  total: number;
  last7Days: number;
  last30Days: number;
  accepted: number;
  declined: number;
  pendingOpen: number;
}

/** `pendingOpen` is every status that isn't a terminal one (`accepted`/`declined`) — see `QUOTE_STATUS_TRANSITIONS` in packages/types for why those two are the only terminal states. */
export async function getQuoteCounts(
  db: Queryable,
  sevenDaysAgoIso: string,
  thirtyDaysAgoIso: string,
): Promise<AdminQuoteCounts> {
  const result = await db.query<{
    total: string;
    last_7_days: string;
    last_30_days: string;
    accepted: string;
    declined: string;
    pending_open: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE created_at >= $1) AS last_7_days,
       COUNT(*) FILTER (WHERE created_at >= $2) AS last_30_days,
       COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
       COUNT(*) FILTER (WHERE status = 'declined') AS declined,
       COUNT(*) FILTER (WHERE status NOT IN ('accepted', 'declined')) AS pending_open
     FROM quotes`,
    [sevenDaysAgoIso, thirtyDaysAgoIso],
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    last7Days: Number(row?.last_7_days ?? 0),
    last30Days: Number(row?.last_30_days ?? 0),
    accepted: Number(row?.accepted ?? 0),
    declined: Number(row?.declined ?? 0),
    pendingOpen: Number(row?.pending_open ?? 0),
  };
}

export async function getCustomerCount(db: Queryable): Promise<number> {
  const result = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM customers`);
  return Number(result.rows[0]?.count ?? 0);
}

/** Raw creation timestamps within a window, for the growth chart — bucketing by day happens in JS (`services/admin.ts`), not SQL, consistent with this codebase's existing "no SQL-side date arithmetic" convention. Bounded by the window, not total table size. */
export async function listBusinessCreatedAtSince(db: Queryable, sinceIso: string): Promise<string[]> {
  const result = await db.query<{ created_at: string }>(`SELECT created_at FROM businesses WHERE created_at >= $1`, [
    sinceIso,
  ]);
  return result.rows.map((row) => row.created_at);
}

export async function listQuoteCreatedAtSince(db: Queryable, sinceIso: string): Promise<string[]> {
  const result = await db.query<{ created_at: string }>(`SELECT created_at FROM quotes WHERE created_at >= $1`, [
    sinceIso,
  ]);
  return result.rows.map((row) => row.created_at);
}

export interface AdminRecentEventRow {
  kind: "business_signed_up" | "subscription_started" | "subscription_canceled" | "quote_created" | "quote_accepted" | "quote_declined";
  occurredAt: string;
  businessId: string;
  businessName: string;
  detail?: string;
}

/**
 * Derives a recent-activity feed entirely from timestamp columns that
 * already exist — deliberately NOT a dedicated event/audit table (see
 * docs/decisions/0035-admin-dashboard.md's "Deferred Features": a real
 * audit log, with richer event types like logins or plan changes, is
 * future work). Six small, independently-limited queries rather than one
 * giant UNION so each stays a simple indexed scan; `services/admin.ts`
 * merges and re-sorts the combined, already-small result set in JS.
 */
export async function listRecentActivityEvents(db: Queryable, limitPerKind: number): Promise<AdminRecentEventRow[]> {
  const businessSignups = await db.query<{ id: string; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM businesses ORDER BY created_at DESC LIMIT $1`,
    [limitPerKind],
  );
  const subscriptionsStarted = await db.query<{ business_id: string; business_name: string; created_at: string; plan_id: string }>(
    `SELECT s.business_id, b.name AS business_name, s.created_at, s.plan_id
     FROM subscriptions s JOIN businesses b ON b.id = s.business_id
     ORDER BY s.created_at DESC LIMIT $1`,
    [limitPerKind],
  );
  const subscriptionsCanceled = await db.query<{ business_id: string; business_name: string; canceled_at: string }>(
    `SELECT s.business_id, b.name AS business_name, s.canceled_at
     FROM subscriptions s JOIN businesses b ON b.id = s.business_id
     WHERE s.canceled_at IS NOT NULL
     ORDER BY s.canceled_at DESC LIMIT $1`,
    [limitPerKind],
  );
  const quotesCreated = await db.query<{ business_id: string; business_name: string; created_at: string }>(
    `SELECT q.business_id, b.name AS business_name, q.created_at
     FROM quotes q JOIN businesses b ON b.id = q.business_id
     ORDER BY q.created_at DESC LIMIT $1`,
    [limitPerKind],
  );
  const quotesAccepted = await db.query<{ business_id: string; business_name: string; accepted_at: string }>(
    `SELECT q.business_id, b.name AS business_name, q.accepted_at
     FROM quotes q JOIN businesses b ON b.id = q.business_id
     WHERE q.accepted_at IS NOT NULL
     ORDER BY q.accepted_at DESC LIMIT $1`,
    [limitPerKind],
  );
  const quotesDeclined = await db.query<{ business_id: string; business_name: string; declined_at: string }>(
    `SELECT q.business_id, b.name AS business_name, q.declined_at
     FROM quotes q JOIN businesses b ON b.id = q.business_id
     WHERE q.declined_at IS NOT NULL
     ORDER BY q.declined_at DESC LIMIT $1`,
    [limitPerKind],
  );

  const events: AdminRecentEventRow[] = [
    ...businessSignups.rows.map((r) => ({
      kind: "business_signed_up" as const,
      occurredAt: r.created_at,
      businessId: r.id,
      businessName: r.name,
    })),
    ...subscriptionsStarted.rows.map((r) => ({
      kind: "subscription_started" as const,
      occurredAt: r.created_at,
      businessId: r.business_id,
      businessName: r.business_name,
      detail: r.plan_id,
    })),
    ...subscriptionsCanceled.rows.map((r) => ({
      kind: "subscription_canceled" as const,
      occurredAt: r.canceled_at,
      businessId: r.business_id,
      businessName: r.business_name,
    })),
    ...quotesCreated.rows.map((r) => ({
      kind: "quote_created" as const,
      occurredAt: r.created_at,
      businessId: r.business_id,
      businessName: r.business_name,
    })),
    ...quotesAccepted.rows.map((r) => ({
      kind: "quote_accepted" as const,
      occurredAt: r.accepted_at,
      businessId: r.business_id,
      businessName: r.business_name,
    })),
    ...quotesDeclined.rows.map((r) => ({
      kind: "quote_declined" as const,
      occurredAt: r.declined_at,
      businessId: r.business_id,
      businessName: r.business_name,
    })),
  ];

  return events;
}

export type AdminBusinessSortBy = "createdAt" | "name" | "quoteCount";
export type AdminSortDirection = "asc" | "desc";

export interface AdminBusinessListRow {
  id: string;
  name: string;
  email: string;
  ownerEmail: string | null;
  createdAt: string;
  planId: string | null;
  subscriptionStatus: string | null;
  /** Stripe's raw status, if known yet — see `Subscription.providerStatus`'s own comment in repositories/subscriptions.ts. */
  providerStatus: string | null;
  trialUsedAt: string | null;
  quoteCount: number;
  customerCount: number;
  lastQuoteAt: string | null;
}

interface AdminBusinessListRowDb {
  id: string;
  name: string;
  email: string;
  created_at: string;
  owner_email: string | null;
  plan_id: string | null;
  subscription_status: string | null;
  provider_status: string | null;
  trial_used_at: string | null;
  quote_count: string;
  customer_count: string;
  last_quote_at: string | null;
}

function toAdminBusinessListRow(row: AdminBusinessListRowDb): AdminBusinessListRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    planId: row.plan_id,
    subscriptionStatus: row.subscription_status,
    providerStatus: row.provider_status,
    trialUsedAt: row.trial_used_at,
    quoteCount: Number(row.quote_count),
    customerCount: Number(row.customer_count),
    lastQuoteAt: row.last_quote_at,
  };
}

/** Maps a caller-chosen sort option to a fixed, safe `ORDER BY` fragment — never interpolates a caller-supplied column/direction string directly into SQL. */
const SORT_COLUMNS: Record<AdminBusinessSortBy, string> = {
  createdAt: "b.created_at",
  name: "b.name",
  quoteCount: "quote_count",
};

export interface ListBusinessesForAdminOptions {
  search?: string;
  limit: number;
  offset: number;
  sortBy: AdminBusinessSortBy;
  sortDirection: AdminSortDirection;
}

/**
 * The one genuinely large, paginated admin query — businesses is the
 * table expected to actually grow into the thousands (see
 * docs/decisions/0035-admin-dashboard.md's "Performance" section).
 * `quote_count`/`customer_count`/`last_quote_at` are correlated
 * subqueries, each hitting `idx_quotes_business_id`/`idx_customers_business_id`
 * (already indexed) and bounded to this page's `LIMIT` rows, not to the
 * total table size — this is standard, single-round-trip SQL, not the
 * per-row-round-trip N+1 pattern the task description warns about.
 */
export async function listBusinessesForAdmin(
  db: Queryable,
  options: ListBusinessesForAdminOptions,
): Promise<AdminBusinessListRow[]> {
  const direction = options.sortDirection === "asc" ? "ASC" : "DESC";
  const orderColumn = SORT_COLUMNS[options.sortBy];
  const search = options.search?.trim();
  const whereClause = search ? `WHERE b.name ILIKE $3 OR b.email ILIKE $3` : "";
  const params: unknown[] = [options.limit, options.offset];
  if (search) params.push(`%${search}%`);

  const result = await db.query<AdminBusinessListRowDb>(
    `SELECT
       b.id, b.name, b.email, b.created_at,
       (SELECT email FROM users WHERE business_id = b.id ORDER BY created_at ASC LIMIT 1) AS owner_email,
       s.plan_id, s.status AS subscription_status, s.provider_status, s.trial_used_at,
       (SELECT COUNT(*) FROM quotes WHERE business_id = b.id) AS quote_count,
       (SELECT COUNT(*) FROM customers WHERE business_id = b.id) AS customer_count,
       (SELECT MAX(created_at) FROM quotes WHERE business_id = b.id) AS last_quote_at
     FROM businesses b
     LEFT JOIN subscriptions s ON s.business_id = b.id
     ${whereClause}
     ORDER BY ${orderColumn} ${direction}
     LIMIT $1 OFFSET $2`,
    params,
  );
  return result.rows.map(toAdminBusinessListRow);
}

export async function countBusinessesForAdmin(db: Queryable, search?: string): Promise<number> {
  const trimmed = search?.trim();
  if (trimmed) {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM businesses WHERE name ILIKE $1 OR email ILIKE $1`,
      [`%${trimmed}%`],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
  const result = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM businesses`);
  return Number(result.rows[0]?.count ?? 0);
}
