-- Secure quote sharing (ADR 0012). Possession of the raw token is the
-- entire access credential; only its SHA-256 hash is ever stored, the same
-- pattern as sessions.token_hash.

CREATE TABLE quote_share_tokens (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_quote_share_tokens_quote_id ON quote_share_tokens(quote_id);
CREATE INDEX idx_quote_share_tokens_business_id ON quote_share_tokens(business_id);

-- At most one active (non-revoked) token per quote — "regenerate" revokes
-- the current one and inserts a new row rather than updating in place, so
-- every token that was ever valid stays in the table as an audit trail.
-- Postgres supports partial unique indexes natively, so this is a direct,
-- unmodified translation of the SQLite version — no application-level
-- race window is introduced or widened by this migration.
CREATE UNIQUE INDEX idx_quote_share_tokens_one_active_per_quote
  ON quote_share_tokens(quote_id) WHERE revoked_at IS NULL;
