-- Postgres schema, Phase 1 of production readiness (see
-- docs/decisions/0021-postgres-migration.md). Consolidates the current
-- FINAL shape of the core tables — not a replay of the incremental SQLite
-- ALTER TABLE history in services/api/src/db/migrations/0001-0004/0008,
-- since this targets a fresh Postgres database with no prior rows to carry
-- forward. Column-by-column provenance is documented in the ADR.
--
-- Deliberate, documented departures from a mechanical SQLite->Postgres
-- copy (see the ADR for the full reasoning):
--   * Timestamps stay TEXT (ISO-8601 strings, exactly as
--     `new Date().toISOString()` already produces) rather than TIMESTAMPTZ.
--     The app never relies on SQL-side date arithmetic (confirmed: no
--     `datetime()`/`julianday()`/`strftime()` use anywhere in the
--     codebase) and TIMESTAMPTZ would make `pg` return JS `Date` objects
--     instead of strings, a behavioral change every repository's read path
--     would have to account for. Deferred as a future hardening, not
--     required for Phase 1.
--   * JSON-blob columns (`*_json`) stay TEXT for the same reason: the app
--     always round-trips them through JSON.stringify/JSON.parse in JS and
--     never queries into them via SQL, and JSONB would make `pg` return a
--     parsed object instead of a string, breaking every existing
--     `JSON.parse(row.foo_json)` call site.
--   * IDs stay TEXT (app-generated `prefix_<uuid>` values from
--     `db/ids.ts`'s `makeId()`) — never SERIAL/IDENTITY. Nothing in the
--     codebase depends on `last_insert_rowid()` or autoincrement.

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  service_area TEXT NOT NULL DEFAULT '',
  default_industry TEXT NOT NULL DEFAULT 'window-cleaning',
  created_at TEXT NOT NULL,
  -- Phase 14 (ADR 0016): public, opaque, never the internal id.
  public_embed_id TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  brand_color TEXT,
  embed_last_seen_at TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  email TEXT NOT NULL UNIQUE,
  -- Nullable since ADR 0019: a Google-only account has no password
  -- credential — never a fake placeholder hash.
  password_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_users_business_id ON users(business_id);

-- Looked up by the SHA-256 hash of the opaque bearer token stored in the
-- browser's cookie, never by the raw token — a leaked row alone is not a
-- usable session credential.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE pricing_configurations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  industry TEXT NOT NULL,
  currency TEXT NOT NULL,
  version INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  rules_json TEXT NOT NULL
);
CREATE INDEX idx_pricing_configurations_business_id ON pricing_configurations(business_id);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- A default/contact address placeholder — never written to by any code
  -- path today, and never authoritative for a specific quote's job
  -- location (see `quotes.property_address` below, and
  -- docs/decisions/0020-required-service-address.md).
  address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_business_id ON customers(business_id);
CREATE INDEX idx_customers_business_id_email ON customers(business_id, email);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  pricing_config_id TEXT NOT NULL REFERENCES pricing_configurations(id),
  property_type TEXT NOT NULL,
  property_stories INTEGER NOT NULL,
  -- Nullable at the database level, required at the application layer
  -- (services/quotes.ts's `persistPricedQuote`) for every quote created
  -- from ADR 0020 onward. See that ADR for why a NOT NULL constraint is
  -- deliberately NOT applied here yet, and this file's own migration
  -- header in the ADR for the production data implication (a fresh
  -- Postgres database has no legacy rows to worry about, but the
  -- column stays nullable for consistency with the application-layer-only
  -- enforcement strategy, and so a future direct SQL import/backfill tool
  -- is never blocked by a constraint the application already guarantees).
  property_address TEXT,
  service_preferences_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  photos_json TEXT NOT NULL DEFAULT '[]',
  analysis_json TEXT NOT NULL,
  estimate_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Customer interaction/response tracking (ADR 0012) — nullable, set only
  -- as the corresponding event actually happens.
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  accepted_at TEXT,
  declined_at TEXT,
  changes_requested_at TEXT,
  customer_request_note TEXT,
  -- The AI's raw per-field observation (ADR 0015), preserved separately
  -- from analysis_json (the human-confirmed characteristics actually
  -- priced). Null for a manually-entered quote.
  ai_observation_json TEXT,
  -- Most-recent "send quote by email" attempt only, not a history (ADR 0016).
  email_sent_at TEXT,
  email_delivery_status TEXT,
  email_provider_message_id TEXT
);
CREATE INDEX idx_quotes_business_id ON quotes(business_id);
CREATE INDEX idx_quotes_customer_id ON quotes(customer_id);
