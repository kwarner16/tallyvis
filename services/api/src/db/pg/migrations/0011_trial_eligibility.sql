-- Trial-abuse hardening (see docs/decisions/0034-trial-eligibility.md).
-- A dedicated, permanent marker for "has this business ever actually
-- received a free trial" — deliberately SEPARATE from `trial_started_at`
-- (which already exists and reflects the MOST RECENT trial's start date,
-- and would be overwritten by a second trial if the abuse this migration
-- closes were ever allowed to happen again). `trial_used_at` is written
-- exactly once, the first time a business is granted a trial, and is
-- never cleared or overwritten after that by any code path — see
-- `services/api/src/repositories/subscriptions.ts`'s `upsertSubscription`
-- (COALESCE-preserve, same pattern every other durable-history column on
-- this table already uses) and `services/subscriptions.ts`'s
-- `createCheckoutSessionForPlan` (the only place it is ever set).
--
-- Backfill: every business that has EVER recorded a trial start (even one
-- that is now canceled/expired, or whose subscription was later deleted)
-- already used its one free trial — reusing `trial_started_at`'s own
-- existing value is exact and requires no guessing, since that column
-- itself has never been cleared once set.

ALTER TABLE subscriptions ADD COLUMN trial_used_at TEXT;

UPDATE subscriptions
SET trial_used_at = trial_started_at
WHERE trial_started_at IS NOT NULL AND trial_used_at IS NULL;
