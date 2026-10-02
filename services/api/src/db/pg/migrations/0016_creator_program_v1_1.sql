-- TallyVis Founding Creator Program V1.1 hardening (2026-10 — see
-- docs/decisions/0040-creator-affiliate-program.md's V1.1 addendum for
-- the full reasoning). Purely additive: no existing column's meaning
-- changes, and `creators`/`creator_referrals`/`creator_commissions` had
-- zero rows in production at the time this was written, so there is no
-- backfill concern either.

-- Activation/activity tracking for the "Active Creator" program rule —
-- see services/creators.ts's `firstActivityMonthStart`. All nullable:
-- absent simply means "not yet known," never fabricated.
ALTER TABLE creators ADD COLUMN activated_at TEXT;
ALTER TABLE creators ADD COLUMN last_qualifying_content_at TEXT;
ALTER TABLE creators ADD COLUMN last_qualifying_content_url TEXT;
ALTER TABLE creators ADD COLUMN last_qualifying_content_note TEXT;

-- The tax-excluded commissionable base, kept SEPARATE from
-- collected_amount_cents (which keeps its original meaning: the full
-- gross amount Stripe actually collected, for audit/display) — see
-- services/creatorCommissions.ts's own comment on `invoice.tax`.
-- Backfilled to collected_amount_cents for the (zero, as of this
-- migration) existing rows so the column is never null going forward.
ALTER TABLE creator_commissions ADD COLUMN commissionable_amount_cents INTEGER;
UPDATE creator_commissions SET commissionable_amount_cents = collected_amount_cents WHERE commissionable_amount_cents IS NULL;
ALTER TABLE creator_commissions ALTER COLUMN commissionable_amount_cents SET NOT NULL;

-- Proportional-refund tracking — see services/creatorCommissions.ts's
-- `processChargeRefunded`. Both are CUMULATIVE totals, not per-event
-- deltas, recomputed from Stripe's own cumulative `charge.amount_refunded`
-- on every `charge.refunded` event — which is what makes re-deriving
-- `reversed_commission_cents` from `refunded_collected_cents` naturally
-- idempotent against webhook replay and safe across multiple partial
-- refunds (a later, larger cumulative total simply recomputes a larger,
-- still-capped reversal; an exact replay recomputes the identical value).
ALTER TABLE creator_commissions ADD COLUMN refunded_collected_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE creator_commissions ADD COLUMN reversed_commission_cents INTEGER NOT NULL DEFAULT 0;

-- A ledger of negative (or, in principle, manual positive) adjustments
-- against a creator's FUTURE payable balance — created ONLY when a
-- refund arrives for a commission that was already marked `'paid'` (see
-- that function's own comment for why the commission row itself is never
-- touched in that case: preserving the real, historical payout record
-- rather than clawing it back). `creator_commissions.status`/`paid_at`
-- for an ALREADY-ACCRUED (not yet paid) commission is adjusted directly
-- on the row instead (via the two columns above) — this table exists
-- specifically for the one case that must never rewrite history.
CREATE TABLE creator_commission_adjustments (
  id TEXT PRIMARY KEY,
  commission_id TEXT NOT NULL REFERENCES creator_commissions(id),
  creator_id TEXT NOT NULL REFERENCES creators(id),
  -- Negative = money owed back by the creator, netted against their next
  -- payout. Never applied automatically to a bank/payout rail — V1.1
  -- still has no automated payouts of any kind.
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_creator_commission_adjustments_creator_id ON creator_commission_adjustments(creator_id);
CREATE INDEX idx_creator_commission_adjustments_commission_id ON creator_commission_adjustments(commission_id);
