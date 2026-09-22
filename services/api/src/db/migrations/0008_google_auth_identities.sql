-- V1 account/product features phase: Google Sign-In. See
-- docs/decisions/0019-account-settings-and-google-auth.md.
--
-- Two changes:
--
-- 1. `users.password_hash` becomes NULLABLE — a Google-only account has no
--    password credential, and this repo's explicit policy is "no fake
--    placeholder password hashes for Google users" (a fake hash would be
--    indistinguishable from a real one at the schema level, an active
--    footgun). SQLite has no `ALTER COLUMN`, so relaxing a NOT NULL
--    constraint requires the standard rebuild-the-table pattern: create
--    the new shape, copy every row verbatim (ids unchanged, so every
--    other table's `user_id` foreign key — `sessions`, soon
--    `auth_identities` — still resolves correctly by value), drop the
--    old table, rename. `password_hash` is the ONLY column changing;
--    every other column, all data, and every index/foreign-key-by-value
--    relationship survives byte-for-byte.
--
-- 2. `auth_identities` — a normalized table linking a `users` row to one
--    or more external identity-provider accounts, rather than overloading
--    `users` with per-provider nullable columns. A password-only user has
--    zero rows here; a Google-only user has no `password_hash` but one
--    row here; nothing prevents a future user from having both a password
--    AND a linked identity. `provider_account_id` is Google's stable
--    `sub` claim — the permanent identity key — never the user's email,
--    which can change and is never trustworthy as a long-lived primary
--    key (see docs/decisions/0019's account-linking rules for why).
--    `email` here is purely a denormalized, informational snapshot of
--    what that provider reported at link time (for display/audit only —
--    e.g. showing "Linked: name@gmail.com" in settings); it is NEVER used
--    to look up or match an identity, only `(provider, provider_account_id)` is.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO users_new (id, business_id, email, password_hash, created_at)
  SELECT id, business_id, email, password_hash, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identities_provider_account ON auth_identities(provider, provider_account_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);
