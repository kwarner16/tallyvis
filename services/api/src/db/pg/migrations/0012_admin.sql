-- Internal TallyVis CEO/Admin dashboard foundation (see
-- docs/decisions/0035-admin-dashboard.md).
--
-- `users.is_admin` is the one, minimal server-side authorization signal
-- the admin area is gated on — there is no existing role system to reuse
-- (confirmed: no `role`/`permission` column anywhere in the schema before
-- this migration). Lives on `users`, not `businesses`, because
-- authorization is inherently per-LOGIN (an `AuthSession` carries a
-- `userId`), not per-tenant — mirrors `password_hash`, the other
-- per-login-identity column on this same table. Defaults FALSE so every
-- existing row (every real customer account) stays a normal, non-admin
-- user with no behavior change; granting it to the TallyVis founder's own
-- account is a deliberate, separate, out-of-band step (see
-- `db/grantAdmin.ts`) — this migration itself never grants admin access to
-- anyone.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- The admin dashboard's "new in last 7/30 days" business counts and
-- "businesses created over time" growth chart both filter/bucket
-- `businesses.created_at` — neither existed as a query pattern before this
-- feature (every other lookup of a business is by `id` or
-- `public_embed_id`, both already indexed). Same reasoning for
-- `quotes.created_at` (quote-volume counts/trend). Table sizes are small
-- today, but both are plain range-scan indexes on a column this dashboard
-- will query on every load, so adding them now is the smallest change that
-- keeps the dashboard cheap as the platform grows — see
-- docs/decisions/0035-admin-dashboard.md's "Performance" section.
CREATE INDEX idx_businesses_created_at ON businesses(created_at);
CREATE INDEX idx_quotes_created_at ON quotes(created_at);
