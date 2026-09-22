-- Account recovery, billing/subscriptions (ADRs 0016-0019).

-- Password reset tokens — same "store only the hash" pattern as
-- sessions.token_hash / quote_share_tokens.token_hash. Single-use:
-- consumed by setting used_at, never deleted, so a replay of an
-- already-used token is still detectable/rejected, not silently
-- "not found".
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- One row per business — its CURRENT billing state, not a full event
-- history. `plan_id` references @tallyvis/config's PLANS (code-defined),
-- not a database table.
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id),
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trial_started_at TEXT,
  trial_ends_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  billing_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_checkout_session_id TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Stripe at-least-once webhook delivery idempotency (ADR 0017): records
  -- the most recently APPLIED event's id, so a byte-for-byte replay is
  -- recognized and skipped.
  last_webhook_event_id TEXT,
  -- Out-of-order delivery guard (ADR 0018): the most recently applied
  -- event's own `created` (a Stripe-assigned Unix timestamp, seconds) —
  -- BIGINT rather than INTEGER since a plain `INTEGER`/int4 overflows
  -- Unix-seconds timestamps in 2038; this is the one column in the whole
  -- schema where the SQLite type (bare INTEGER, unbounded precision) and
  -- Postgres's fixed-width integers actually differ in a way that matters.
  last_webhook_event_created_at BIGINT,
  -- Distinguishes ACTIVE/TRIALING from ACTIVE/TRIALING-BUT-SCHEDULED from
  -- ACTUALLY CANCELED (ADR 0019/"V1 account features"). A genuine boolean
  -- in Postgres — SQLite has no native boolean type so the original schema
  -- used INTEGER 0/1; this is the one deliberate type upgrade in this
  -- migration (see docs/decisions/0021-postgres-migration.md), isolated to
  -- `repositories/subscriptions.ts`'s read/write mapping.
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at TEXT
);
CREATE INDEX idx_subscriptions_business_id ON subscriptions(business_id);

-- One-time charges (e.g. website installation) — deliberately separate
-- from `subscriptions`, which only ever represents the recurring plan.
--
-- NO UNIQUE(business_id, kind) constraint: confirmed against actual
-- application code (`repositories/billingCharges.ts`'s
-- `getBillingChargeByKind`) that the intended invariant is "most recent
-- row for this (business, kind) wins" (`ORDER BY created_at DESC LIMIT 1`),
-- not "exactly one row ever exists" — the code was already written to
-- tolerate multiple charge rows per kind over time (e.g. an abandoned
-- pending charge followed by a fresh one). Adding a uniqueness constraint
-- here would conflict with that already-shipped behavior, not protect it.
CREATE TABLE billing_charges (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider_charge_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_billing_charges_business_id ON billing_charges(business_id);
