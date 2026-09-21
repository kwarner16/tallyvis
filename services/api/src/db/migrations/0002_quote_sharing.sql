-- Phase 10: secure quote sharing + customer activity/response tracking.
-- See docs/decisions/0012-secure-quote-sharing.md.
--
-- Replaces the Phase 8/9 placeholder public quote route (which used the
-- quote's own database id as its only "authorization" — see ADR 0010's
-- explicitly-stated limitation) with a dedicated, revocable share-token
-- mechanism: possession of the raw token is the entire access credential,
-- and only its SHA-256 hash is ever stored here, the same pattern
-- `sessions.token_hash` already established for login sessions.

CREATE TABLE IF NOT EXISTS quote_share_tokens (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_share_tokens_quote_id ON quote_share_tokens(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_share_tokens_business_id ON quote_share_tokens(business_id);
-- At most one active (non-revoked) token per quote — "regenerate" revokes
-- the current one and inserts a new row rather than updating in place, so
-- every token that was ever valid stays in the table as an audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_share_tokens_one_active_per_quote
  ON quote_share_tokens(quote_id) WHERE revoked_at IS NULL;

-- Customer interaction/response tracking, recorded directly on the quote it
-- describes — nullable, set only as the corresponding event actually
-- happens, never backfilled or guessed.
ALTER TABLE quotes ADD COLUMN first_viewed_at TEXT;
ALTER TABLE quotes ADD COLUMN last_viewed_at TEXT;
ALTER TABLE quotes ADD COLUMN accepted_at TEXT;
ALTER TABLE quotes ADD COLUMN declined_at TEXT;
ALTER TABLE quotes ADD COLUMN changes_requested_at TEXT;
ALTER TABLE quotes ADD COLUMN customer_request_note TEXT;
