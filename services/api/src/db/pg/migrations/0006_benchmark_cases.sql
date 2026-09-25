-- Internal estimator benchmark harness (final validation & launch-readiness
-- phase, 2026-09). One row per test case a business owner runs from
-- /dashboard/testing to compare the AI pipeline's output against a known
-- ground truth. Business-scoped and authenticated only, like every other
-- table here — never reachable from the public estimator.
--
-- Deliberately does NOT store the submitted photos themselves (data URL or
-- otherwise) — only `photo_count`. The AI pipeline this harness calls
-- (`analyzePropertyForBusiness`, the exact same function the real
-- estimator/dashboard use — no second implementation) already never
-- persists photo bytes itself; this table follows the same
-- privacy/retention posture rather than introducing a new permanent photo
-- store just for internal testing. See docs comment on
-- services/api/src/services/benchmarkCases.ts for the full reasoning.
--
-- `raw_observation_json`/`evidence_messages_json`/`confirmed_characteristics_json`/
-- `final_estimate_json` follow the same JSON-in-TEXT convention as every
-- other `*_json` column in this schema (see 0001_core.sql's own comment).

CREATE TABLE benchmark_cases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),

  -- Property/test information (Part 2 of the mission brief).
  test_name TEXT,
  address TEXT,
  property_type TEXT,
  tested_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- JSON array of condition-tag strings (see benchmarkCases.ts's
  -- BENCHMARK_CONDITIONS for the fixed, reviewed set).
  conditions_json TEXT NOT NULL DEFAULT '[]',
  photo_count INTEGER NOT NULL DEFAULT 0,

  -- The AI's raw result, preserved separately from anything a human
  -- confirmed afterward (Part 3) — never overwritten once saved, matching
  -- how quotes.ai_observation_json already works.
  raw_observation_json TEXT,
  ai_window_count INTEGER,
  ai_window_status TEXT,
  ai_screen_count INTEGER,
  ai_screen_status TEXT,
  ai_stories INTEGER,
  ai_stories_status TEXT,
  ai_overall_confidence TEXT,
  evidence_coverage TEXT,
  evidence_overall TEXT,
  evidence_issues_json TEXT NOT NULL DEFAULT '[]',
  more_photos_recommended BOOLEAN NOT NULL DEFAULT false,
  evidence_messages_json TEXT NOT NULL DEFAULT '[]',

  -- The tester's simulated customer confirmation/correction, and the
  -- resulting reconciled confidence used to decide escalation.
  confirmed_characteristics_json TEXT,
  confirmed_confidence TEXT,
  would_need_review BOOLEAN,
  final_estimate_json TEXT,

  -- Ground truth (Part 2's "actual known values") — nullable, since a
  -- tester may not know every field for every case.
  gt_window_count INTEGER,
  gt_screen_count INTEGER,
  gt_stories INTEGER,
  gt_accessibility TEXT,

  -- Optional link to an earlier case for the same property (Part 4's
  -- "did a subsequent run improve accuracy" follow-up-photo tracking) —
  -- intentionally not a foreign key with ON DELETE behavior: a benchmark
  -- case is never deleted by anything else in this schema, and a stale
  -- link here is just excluded from the paired-comparison metric, never a
  -- correctness problem for the row it points from.
  previous_case_id TEXT,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_benchmark_cases_business_id ON benchmark_cases(business_id);
