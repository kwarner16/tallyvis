-- Phase 14 Stripe V1 hardening: guard against an older, distinct webhook
-- event being applied AFTER a newer one due to out-of-order delivery. See
-- docs/decisions/0018-stripe-v1-hardening.md.
--
-- `last_webhook_event_id` (0005) only recognizes an exact replay of the
-- most recently applied event. It does nothing if two DIFFERENT events for
-- the same subscription arrive out of order (e.g. an `updated` event sent
-- before an earlier `created` event, delayed by retry/network jitter,
-- finally arrives and would otherwise stomp the newer state). Every real
-- Stripe event carries a `created` field (a Unix timestamp Stripe assigns
-- when the event itself was generated) — storing the most recently
-- APPLIED event's `created` value lets the handler reject a late-arriving
-- OLDER event outright, regardless of whether its id matches anything on
-- file.

ALTER TABLE subscriptions ADD COLUMN last_webhook_event_created_at INTEGER;
