-- Google-signup onboarding gap fix (2026-09). A brand-new Google signup
-- gets a placeholder business name (see services/googleAuth.ts's
-- deriveBusinessName) and no way to set a password, with no forced step
-- to fix either before landing in the real dashboard. This column lets
-- the dashboard require a one-time "finish setting up" step for exactly
-- those accounts, and only those — every other business (password
-- signup, or a Google account that's already completed it) defaults to
-- false, so nothing retroactively interrupts an existing session.

ALTER TABLE businesses ADD COLUMN needs_onboarding BOOLEAN NOT NULL DEFAULT false;
