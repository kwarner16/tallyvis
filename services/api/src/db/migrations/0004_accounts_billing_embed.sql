-- Phase 14: account recovery, billing/subscriptions, and website-embed
-- foundation. See docs/decisions/0016-onboarding-billing-embed.md.

-- 1. Password reset tokens — the same "store only the hash" pattern as
-- sessions.token_hash / quote_share_tokens.token_hash. Single-use: consumed
-- by setting used_at, never deleted (so a replay of an already-used token
-- is still detectable/rejected, not silently "not found").
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- 2. Business: a public, opaque embed identifier distinct from the
-- internal businessId (never exposed for protected operations — see
-- docs/decisions/0011's "never trust client-supplied businessId"), plus
-- minimal branding fields and a last-seen signal for the dashboard's
-- "is this actually installed" check.
ALTER TABLE businesses ADD COLUMN public_embed_id TEXT;
ALTER TABLE businesses ADD COLUMN logo_url TEXT;
ALTER TABLE businesses ADD COLUMN brand_color TEXT;
ALTER TABLE businesses ADD COLUMN embed_last_seen_at TEXT;

-- Backfill every existing business with a random embed id — new businesses
-- get one assigned at creation time instead (see repositories/businesses.ts).
UPDATE businesses SET public_embed_id = lower(hex(randomblob(12))) WHERE public_embed_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_embed_id ON businesses(public_embed_id);

-- 3. Subscriptions — one row per business (its CURRENT billing state, not
-- a full event history), reconcilable against a real billing provider
-- later. `plan_id` references @tallyvis/config's PLANS, not a database
-- table — plans are code-defined, the single authoritative source shared
-- by apps/web's pricing section and apps/app's onboarding/billing.
CREATE TABLE IF NOT EXISTS subscriptions (
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
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business_id ON subscriptions(business_id);

-- 4. One-time charges (e.g. website installation) — deliberately separate
-- from `subscriptions`, which only ever represents the recurring plan.
CREATE TABLE IF NOT EXISTS billing_charges (
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
CREATE INDEX IF NOT EXISTS idx_billing_charges_business_id ON billing_charges(business_id);

-- 5. Minimal quote-email delivery metadata — a single current-attempt
-- slot, the same "most recent, not a history" shape 0002 already
-- established for customer_request_note.
ALTER TABLE quotes ADD COLUMN email_sent_at TEXT;
ALTER TABLE quotes ADD COLUMN email_delivery_status TEXT;
ALTER TABLE quotes ADD COLUMN email_provider_message_id TEXT;
