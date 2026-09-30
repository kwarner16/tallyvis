-- Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
-- — optional SMS alerting when a new public-estimator quote comes in.
-- Disabled and unset by default: a business must explicitly opt in AND
-- supply a valid notification number before any text message is ever
-- sent, so this column addition can never itself cause an unsolicited
-- text. `notification_phone` is deliberately separate from the existing
-- customer-facing `phone` column — it's the BUSINESS's own number to be
-- alerted at, never a customer's.

ALTER TABLE businesses ADD COLUMN sms_notifications_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN notification_phone TEXT;
