-- Google Sign-In identity linking (ADR 0019). One row per linked external
-- identity-provider account, rather than overloading `users` with
-- per-provider nullable columns. `provider_account_id` is the provider's
-- own stable subject identifier (Google's `sub` claim) — never the email,
-- which is denormalized here for display only and NEVER used to look up
-- or match an identity.

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_auth_identities_provider_account ON auth_identities(provider, provider_account_id);
CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);
