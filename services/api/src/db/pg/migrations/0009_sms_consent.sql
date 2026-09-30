-- Twilio A2P 10DLC compliance (see
-- docs/decisions/0029-sms-consent-and-a2p-10dlc.md) — a customer's
-- affirmative opt-in to receiving service-related SMS, captured on the
-- public estimator's contact step. Defaults to false/unset for every
-- existing and future row until a customer actually checks the box, so
-- this migration never retroactively marks anyone as opted in.
--
-- sms_consent_at/source/disclosure_version are only ever set together with
-- sms_consent = true, all server-stamped at the moment consent is recorded
-- (see services/customers.ts's createCustomerForBusiness) — never derived
-- from client-supplied timestamps.

ALTER TABLE customers ADD COLUMN sms_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN sms_consent_at TEXT;
ALTER TABLE customers ADD COLUMN sms_consent_source TEXT;
ALTER TABLE customers ADD COLUMN sms_consent_disclosure_version TEXT;
