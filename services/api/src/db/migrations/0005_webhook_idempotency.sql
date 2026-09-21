-- Phase 14 hardening: webhook event idempotency. See
-- docs/decisions/0017-billing-hardening.md.
--
-- Stripe explicitly documents at-least-once delivery — the same event can
-- arrive more than once. `last_webhook_event_id` records the most
-- recently APPLIED event's id per subscription, so a byte-for-byte replay
-- of an already-processed event is recognized and skipped rather than
-- reapplied. This is deliberately a single "most recent event" slot, not
-- a full processed-events log — sufficient to make the two event types
-- this app handles idempotent without a separate table.

ALTER TABLE subscriptions ADD COLUMN last_webhook_event_id TEXT;
