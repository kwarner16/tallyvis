-- Business feedback / bug-report channel (production hardening, 2026-10 —
-- see docs/decisions/0039-embed-logo-signup-notifications-and-feedback.md).
-- Deliberately minimal: no status/workflow column — Kyle reads these in
-- the admin dashboard and follows up by email/phone directly, the same
-- "don't build a ticketing system nobody asked for" reasoning that ADR
-- applies throughout. `business_id`/`user_id` are always server-derived
-- from the submitting session (see services/feedback.ts), never
-- client-supplied, so there is no authorization check this table itself
-- needs to encode beyond the foreign keys.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  source_path TEXT,
  contact_me BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_business_id ON feedback(business_id);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);
