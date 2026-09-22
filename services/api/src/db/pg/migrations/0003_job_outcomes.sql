-- Real-world job outcome & data collection foundation (ADR 0015). One row
-- per quote, added well after the quote itself was priced and never
-- mutating it. Every column is nullable except identity/tenancy/timestamps
-- — a business may only know some of this at first (or ever).

CREATE TABLE job_outcomes (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  status TEXT NOT NULL DEFAULT 'in_progress',
  actual_started_at TEXT,
  actual_completed_at TEXT,
  actual_labor_minutes INTEGER,
  actual_window_count INTEGER,
  actual_screen_count INTEGER,
  actual_story_count INTEGER,
  actual_price REAL,
  -- Reuses the estimator's existing AccessibilityLevel scale
  -- ("easy"/"moderate"/"difficult") rather than inventing a new one.
  actual_difficulty TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_job_outcomes_business_id ON job_outcomes(business_id);
CREATE INDEX idx_job_outcomes_quote_id ON job_outcomes(quote_id);
