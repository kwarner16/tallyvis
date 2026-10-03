-- Founding Creator Outreach Tracker V1 (internal admin tool — see
-- docs/decisions/0042-creator-outreach-tracker.md). The creator-side
-- equivalent of the Sales Call Tracker (migration 0017): Kyle researches
-- and pastes a list of PROSPECTIVE creators, works through them, and
-- eventually converts an interested one into a real `creators` row via
-- the existing, unchanged Founding Creator Program logic. A creator
-- prospect is never itself a `creators` row — importing/contacting one
-- never activates, grants complimentary access, or creates any
-- commission/referral relationship. Purely additive; no existing table
-- changes shape.
--
-- No CHECK constraints below, matching every other migration in this
-- schema — outreach status values are validated and enumerated in the
-- application layer (@tallyvis/config's isCreatorOutreachStatus), the
-- same shape creators.status/isCreatorStatus already uses.

CREATE TABLE creator_prospects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  -- Lowercased/trimmed — one of the two primary duplicate-detection
  -- keys (see the ADR's "Duplicate detection" section). Nullable: a
  -- creator without a publicly verified email is still importable with
  -- just a profile URL.
  normalized_email TEXT,
  platform TEXT NOT NULL DEFAULT '',
  profile_url TEXT,
  -- Canonical lowercased host+path (www./trailing slash/a small known
  -- set of platform tab suffixes like "/videos" stripped) — the OTHER
  -- primary duplicate-detection key. Only ever populated from a
  -- profile_url that passed the http(s)-only safety check; never
  -- derived from an unsafe scheme.
  normalized_profile_url TEXT,
  -- JSON array of additional safe http(s) URLs (other platforms) — this
  -- schema's existing `*_json` TEXT-column convention (0001_core.sql's
  -- own comment): always round-tripped through JSON.stringify/parse in
  -- the app, never queried into via SQL.
  other_profile_urls_json TEXT NOT NULL DEFAULT '[]',
  niche TEXT,
  followers_approx INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT,
  status TEXT NOT NULL DEFAULT 'not_contacted',
  last_contacted_at TEXT,
  follow_up_at TEXT,
  -- Set exactly once, by convertProspectToCreatorAdmin, inside the SAME
  -- transaction that creates the real creators row — see that
  -- function's own comment for why this prevents both an orphaned
  -- creator (on a lost race) and a double conversion of the same
  -- prospect. UNIQUE: a given real creator can be the conversion target
  -- of at most one prospect, ever.
  converted_creator_id TEXT REFERENCES creators(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_creator_prospects_converted_creator_id ON creator_prospects(converted_creator_id) WHERE converted_creator_id IS NOT NULL;
CREATE INDEX idx_creator_prospects_normalized_email ON creator_prospects(normalized_email);
CREATE INDEX idx_creator_prospects_normalized_profile_url ON creator_prospects(normalized_profile_url);
CREATE INDEX idx_creator_prospects_created_at ON creator_prospects(created_at);
CREATE INDEX idx_creator_prospects_follow_up_at ON creator_prospects(follow_up_at);

-- The append-only outreach history for one prospect — the creator-side
-- equivalent of sales_calls, minus the start/end-timer concept an email
-- exchange has no equivalent of: there is no "in progress" email, so
-- recording an activity is always a single, immediate write (see the
-- ADR's "Outreach lifecycle" section), never a two-phase start/end pair.
CREATE TABLE creator_outreach_activities (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES creator_prospects(id),
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  follow_up_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_creator_outreach_activities_prospect_id ON creator_outreach_activities(prospect_id);
CREATE INDEX idx_creator_outreach_activities_created_at ON creator_outreach_activities(created_at);
CREATE INDEX idx_creator_outreach_activities_follow_up_at ON creator_outreach_activities(follow_up_at);
