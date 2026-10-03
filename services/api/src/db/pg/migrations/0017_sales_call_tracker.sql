-- Sales Call Tracker V1 (internal admin tool — see
-- docs/decisions/0041-sales-call-tracker.md). Kyle's own cold-calling
-- workflow: nothing here is customer-facing, and nothing in this schema
-- is ever read by a normal TallyVis business. Purely additive; no
-- existing table changes shape.
--
-- Deliberately separate from businesses/customers/subscriptions — a
-- sales prospect is never a TallyVis business, and a "signed_up" call
-- outcome never creates or implies one (see the ADR's "Signed up is not
-- a paying customer" section). No CHECK constraints below, matching this
-- schema's existing precedent throughout (no other migration uses one) —
-- outcome/objection values are validated and enumerated in the
-- application layer (services/sales*.ts), the same way creators.status
-- already is.

CREATE TABLE sales_prospects (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT NOT NULL,
  -- E.164, via the exact same `normalizePhoneNumber` SMS sending already
  -- uses (services/business.ts) — the sole reliable duplicate-detection
  -- key. Nullable (not UNIQUE): a row whose phone couldn't be normalized
  -- still needs to exist (see the ADR), so uniqueness is enforced in
  -- services/salesProspects.ts, not by a DB constraint.
  normalized_phone TEXT,
  email TEXT,
  website TEXT,
  city TEXT,
  state TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sales_prospects_normalized_phone ON sales_prospects(normalized_phone);
CREATE INDEX idx_sales_prospects_created_at ON sales_prospects(created_at);

CREATE TABLE sales_calls (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(id),
  -- Who was on the call — scopes "one active call at a time" below per
  -- admin, not globally; this tool has one real user today (Kyle), but
  -- nothing here hardcodes that.
  started_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- The authoritative call-start clock — stamped server-side the moment
  -- `startSalesCallAdmin` runs, never trusted from the browser. The
  -- on-screen timer always recomputes elapsed time from THIS column, so
  -- a page refresh mid-call never loses or resets it.
  started_at TEXT NOT NULL,
  -- NULL = still in progress. An outcome/notes/objections/follow-up are
  -- only ever set together with ended_at, by `endSalesCallAdmin`, in one
  -- write — there is no separate "ended but no outcome yet" state.
  ended_at TEXT,
  -- Derived and stored once, at end-call time (ended_at - started_at),
  -- matching this repo's "stamp a derived value once rather than
  -- recompute on every read" convention (e.g. creator_commissions'
  -- own stored amounts). NULL until the call ends.
  duration_seconds INTEGER,
  outcome TEXT,
  notes TEXT NOT NULL DEFAULT '',
  -- JSON array of objection keys (e.g. ["price","needs_to_think"]) —
  -- this schema's existing `*_json` TEXT-column convention (see
  -- 0001_core.sql's own comment): the app always round-trips this
  -- through JSON.stringify/parse and never queries into it via SQL, so
  -- a real array/JSONB column would add nothing V1 needs.
  objections_json TEXT NOT NULL DEFAULT '[]',
  follow_up_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sales_calls_prospect_id ON sales_calls(prospect_id);
CREATE INDEX idx_sales_calls_started_at ON sales_calls(started_at);
CREATE INDEX idx_sales_calls_follow_up_at ON sales_calls(follow_up_at);
-- At most one ACTIVE (unfinished) call per admin at a time — a real
-- database constraint, not just application discipline, so a double-
-- click or two tabs can never create two simultaneous active calls for
-- the same user.
CREATE UNIQUE INDEX idx_sales_calls_one_active_per_user ON sales_calls(started_by_user_id) WHERE ended_at IS NULL;
