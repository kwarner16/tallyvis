-- STOP/START synchronization for the V1 customer SMS program (see
-- docs/decisions/0032-sms-stop-start-sync.md). Twilio's own Messaging
-- Service already suppresses sends at the carrier level the moment a
-- customer replies STOP, but this database had no way to reflect that —
-- the dashboard could keep showing a customer as consented indefinitely
-- after they opted out. This migration adds the two columns the new
-- inbound webhook (services/smsWebhooks.ts) needs to keep `sms_consent`
-- itself in sync, WITHOUT ever overwriting the original opt-in evidence
-- already captured by migration 0009 (sms_consent_at/source/
-- disclosure_version) — those columns are historical and are never
-- touched again once set, by either a STOP or a START.
--
-- Both default to NULL for every existing and future row: a customer who
-- has never opted out has no `sms_opted_out_at`, and one who has never
-- re-opted in after an opt-out has no `sms_reopted_in_at`. Neither column
-- is ever cleared by the other event — each is the single "most recent
-- occurrence of this event" slot, the same convention
-- `quotes.changes_requested_at`/`quotes.email_sent_at` already use.

ALTER TABLE customers ADD COLUMN sms_opted_out_at TEXT;
ALTER TABLE customers ADD COLUMN sms_reopted_in_at TEXT;
