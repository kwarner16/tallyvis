-- TallyVis Founding Creator Program (production feature, 2026-10 — see
-- docs/decisions/0040-creator-affiliate-program.md for the full design).
-- Three tables, deliberately no more: a "potential future click-events
-- table" was considered and rejected for V1 (see that ADR's "Deferred"
-- section) in favor of a plain atomic counter on `creators.click_count`.

-- One row per creator in the program. `slug` is the public, URL-safe
-- referral code (tallyvis.com/r/<slug>) — never an internal id, chosen by
-- Kyle when adding a creator (see creators.ts's validateSlug).
CREATE TABLE creators (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  -- 'prospect' | 'invited' | 'active' | 'paused' | 'inactive' — enforced at
  -- the application layer (services/creators.ts), the same plain-TEXT-
  -- column convention `subscriptions.status`/`billing_charges.status`
  -- already use rather than a Postgres ENUM type.
  status TEXT NOT NULL DEFAULT 'prospect',
  -- Basis points (2000 = 20%), not a float percentage — see
  -- packages/config/src/creatorProgram.ts's own comment for why. This is
  -- the creator's CURRENT rate; see creator_commissions below for why a
  -- past commission is never affected by a later change here.
  commission_rate_bps INTEGER NOT NULL,
  commission_duration_months INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- Optional: set only when this creator also operates their own TallyVis
  -- business (the "free founding-creator access" feature) — see
  -- docs/decisions/0040's "Free creator access" section. NULL for a pure
  -- influencer/creator with no TallyVis account of their own.
  business_id TEXT REFERENCES businesses(id),
  complimentary_access BOOLEAN NOT NULL DEFAULT FALSE,
  -- A plain atomic counter (UPDATE ... SET click_count = click_count + 1),
  -- not a per-click event log — see this file's header comment. Resets
  -- are never performed; the number only ever grows.
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Case-sensitive exact-match uniqueness is intentional: the slug IS the
-- literal URL path segment, and this app's own creation flow lowercases
-- it before storing (see creators.ts), so two creators can never collide
-- on casing in practice either.
CREATE UNIQUE INDEX idx_creators_slug ON creators(slug);
-- A business may be linked to AT MOST one creator's complimentary-access
-- grant — partial index (NULL excluded) so any number of creators may
-- have no linked business at all.
CREATE UNIQUE INDEX idx_creators_business_id ON creators(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX idx_creators_status ON creators(status);

-- The durable, server-side record of "this business was referred by this
-- creator" — see docs/decisions/0040's "Attribution" section. Exactly one
-- row per referred business, enforced by the UNIQUE constraint on
-- business_id below: once created, no code path in this repo ever updates
-- or replaces a business's creator_id, and the constraint itself (not
-- just that discipline) is what makes a second, conflicting attempt fail
-- rather than silently overwrite — see services/creatorReferrals.ts.
CREATE TABLE creator_referrals (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  -- When the referral cookie was first set (the click), carried through
  -- from that cookie's own timestamp at signup — distinct from
  -- `signed_up_at` below, which is always "now" at attribution time. Both
  -- are kept so the admin UI can honestly show "referred on {click date},
  -- signed up on {signup date}" instead of collapsing them into one.
  first_observed_at TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  -- Set the first time a commission-eligible invoice is actually
  -- processed for this referral (see services/creatorCommissions.ts) —
  -- NULL until this business becomes a paying customer. This is the fixed
  -- start of the 12-month (or whatever this creator's current
  -- commission_duration_months is) eligibility window; once set, never
  -- moved, regardless of later cancellations/resubscriptions.
  commission_window_started_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_creator_referrals_business_id ON creator_referrals(business_id);
CREATE INDEX idx_creator_referrals_creator_id ON creator_referrals(creator_id);

-- One row per commission-eligible Stripe invoice payment — see
-- docs/decisions/0040's "Stripe / commissions" section for exactly which
-- webhook event creates these and why. `stripe_invoice_id UNIQUE` is the
-- idempotency mechanism: a replayed `invoice.paid` webhook hits this
-- constraint and is treated as a no-op, never a duplicate commission.
CREATE TABLE creator_commissions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  referral_id TEXT NOT NULL REFERENCES creator_referrals(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  stripe_invoice_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  -- The actual amount Stripe collected for this invoice (already net of
  -- any coupon/discount — see docs/decisions/0040) — never the invoice's
  -- pre-discount subtotal.
  collected_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  -- The creator's rate AT THE MOMENT this row was created — frozen here
  -- independently of creators.commission_rate_bps, which may change later
  -- without altering this historical record. commission_amount_cents is
  -- the computed result (collected_amount_cents * commission_rate_bps /
  -- 10000), stored rather than re-derived so a later rounding-rule change
  -- can never retroactively alter a historical payout figure either.
  commission_rate_bps INTEGER NOT NULL,
  commission_amount_cents INTEGER NOT NULL,
  period_start TEXT,
  period_end TEXT,
  -- 'accrued' (owed, unpaid) | 'reversed' (the underlying payment was
  -- refunded) | 'paid' (Kyle manually marked it paid — see
  -- creator_commissions.paid_at/payout_note). A reversed commission row is
  -- KEPT, never deleted, for audit purposes — see docs/decisions/0040.
  status TEXT NOT NULL DEFAULT 'accrued',
  reversed_at TEXT,
  paid_at TEXT,
  payout_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_creator_commissions_stripe_invoice_id ON creator_commissions(stripe_invoice_id);
CREATE INDEX idx_creator_commissions_creator_id ON creator_commissions(creator_id);
CREATE INDEX idx_creator_commissions_business_id ON creator_commissions(business_id);
CREATE INDEX idx_creator_commissions_status ON creator_commissions(status);
