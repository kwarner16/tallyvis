-- V1 account/product features phase: scheduled subscription cancellation.
-- See docs/decisions/0019-account-settings-and-google-auth.md.
--
-- Distinguishes three states the previous schema could not tell apart:
-- ACTIVE/TRIALING, ACTIVE/TRIALING BUT SCHEDULED TO CANCEL (Stripe's own
-- `cancel_at_period_end`/`cancel_at` on the Subscription object), and
-- ACTUALLY CANCELED (the existing `status = 'canceled'` / `canceled_at`,
-- unchanged). `cancel_at_period_end` defaults to 0 so every existing row
-- (and every row inserted by a caller that has no opinion about
-- cancellation, e.g. `startTrial`) is unambiguously "not scheduled."

ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN cancel_at TEXT;
