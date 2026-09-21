-- Phase 13: real-world job outcome & data collection foundation. See
-- docs/decisions/0015-job-outcome-tracking.md.
--
-- Two additions, both strictly additive — neither touches an existing
-- column, so every historical quote's original pricing/analysis stays
-- exactly as it was priced:
--
-- 1. `quotes.ai_observation_json` preserves the AI's raw per-field
--    observation (RawPropertyObservation — status per field: observed,
--    uncertain, or unknown) separately from `quotes.analysis_json` (the
--    human-confirmed final characteristics `calculateEstimate()` actually
--    priced). Nullable: only set when AI analysis actually produced a
--    result the business went on to save with this quote — a quote entered
--    entirely by hand has nothing to preserve here.
--
-- 2. `job_outcomes` records what actually happened on a completed job —
--    one row per quote, added well after the quote itself was priced and
--    never mutating it. Every column is nullable except identity/tenancy/
--    timestamps: a business may only know some of this at first (or ever),
--    and recording a partial outcome must not be blocked on the rest.

ALTER TABLE quotes ADD COLUMN ai_observation_json TEXT;

CREATE TABLE IF NOT EXISTS job_outcomes (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  -- 'in_progress' until a business explicitly marks the job complete —
  -- mirrors how `quotes.status` is an explicit stored value, not derived.
  status TEXT NOT NULL DEFAULT 'in_progress',
  actual_started_at TEXT,
  actual_completed_at TEXT,
  actual_labor_minutes INTEGER,
  actual_window_count INTEGER,
  actual_screen_count INTEGER,
  actual_story_count INTEGER,
  actual_price REAL,
  -- Reuses the estimator's existing AccessibilityLevel ("easy"/"moderate"/
  -- "difficult") rather than inventing a new categorical scale — the same
  -- field `WindowCleaningCharacteristics.accessibility` already uses.
  actual_difficulty TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_outcomes_business_id ON job_outcomes(business_id);
CREATE INDEX IF NOT EXISTS idx_job_outcomes_quote_id ON job_outcomes(quote_id);
