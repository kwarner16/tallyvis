-- Phase 9 initial schema. See docs/decisions/0011-persistence-auth-and-multi-tenancy.md
-- for the reasoning behind this shape (SQLite, JSON columns for cohesive
-- value objects, business_id as the multi-tenant boundary on every
-- business-owned table).

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  service_area TEXT NOT NULL DEFAULT '',
  default_industry TEXT NOT NULL DEFAULT 'window-cleaning',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);

-- Sessions are looked up by the SHA-256 hash of the opaque bearer token
-- stored in the browser's cookie, never by the raw token itself — a leaked
-- database row alone is not a usable session credential.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS pricing_configurations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  industry TEXT NOT NULL,
  currency TEXT NOT NULL,
  version INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  rules_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pricing_configurations_business_id ON pricing_configurations(business_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id_email ON customers(business_id, email);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  pricing_config_id TEXT NOT NULL REFERENCES pricing_configurations(id),
  property_type TEXT NOT NULL,
  property_stories INTEGER NOT NULL,
  property_address TEXT,
  service_preferences_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  photos_json TEXT NOT NULL DEFAULT '[]',
  analysis_json TEXT NOT NULL,
  estimate_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_business_id ON quotes(business_id);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON quotes(customer_id);
