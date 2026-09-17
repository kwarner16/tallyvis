# 0008 — Quote domain model and mock persistence boundary

**Status:** Accepted (Phase 5)

## Context

Phase 4 built a customer estimator whose result lived only in a per-session
React Context — nothing connected a completed estimate to anything a
business could see. Phase 5 needs a business dashboard operating on the
_same_ quotes customers submit, plus a sensible status workflow, without a
real database or backend yet.

## Decision

**Domain types live in `packages/types`, not `apps/app`.** `Customer`,
`Property`, `ServicePreferences`, `PropertyType`, `TriState`, `QuoteStatus`,
and `Quote` are added there as pure type contracts (`ServicePreferences`
etc. were promoted out of `apps/app`'s estimator, which now re-exports them
so no call site changed). This mirrors how `JobCharacteristics` and
`Estimate` already live there: `packages/types` is the shared contract any
future `services/api` will also need, not something owned by one app.

`Quote` embeds `Customer` and `Property` directly rather than referencing
them by id. This is a deliberate simplification for a single-business,
no-database prototype — a real backend would normalize these into their own
tables with foreign keys, but introducing that normalization now, with
nothing to actually join against, would be speculative complexity.

**Status transitions are centralized as data, not scattered `if` checks.**
`QUOTE_STATUS_TRANSITIONS` (a `Record<QuoteStatus, QuoteStatus[]>`) and
`canTransitionQuoteStatus()` live alongside the type in `packages/types`, so
the same rule set is available to the dashboard UI now and to a real backend
later without being redefined. `declined` is reachable from every non-terminal
status (a business can decline at any point); `accepted`/`declined` are
terminal.

**Mock persistence is app-local.** `apps/app/src/lib/dashboard/store.ts`
holds a `localStorage`-backed store (seeded demo quotes + the business's
editable pricing rules) — the single, clearly-identified location for all
mock data, per the phase brief's explicit instruction not to scatter fake
quote objects through components. This stays in `apps/app` rather than
becoming a new package because it's genuinely the only consumer, matching
the same reasoning as Phase 4's `industry-config.ts`. When `services/api`
is eventually built, this module's functions are what move there — the
shape of its exports (`listQuotes`, `getQuote`, `createQuote`,
`updateQuoteAnalysis`, `updateQuoteStatus`, `getPricingRules`,
`savePricingRules`) is intentionally already API-shaped.

## The real customer → business connection

Two things make this more than two unrelated mock workflows sharing a
types file:

1. The estimator's result page creates a `Quote` in the store the moment
   analysis succeeds — not gated behind the customer clicking "Request this
   service." A business wants visibility into completed estimates
   regardless of whether the customer took further action.
2. The estimator reads its pricing rules **from the same store** the
   dashboard's Pricing page writes to, instead of the static
   `packages/config` default. Changing "per window" price in the dashboard
   changes what the next customer estimate actually charges. This is the
   one existing integration between the two halves of the product that
   makes "you set the rules" a fact about the running app, not just a
   claim in the marketing copy.

## Consequences

- `packages/pricing` and `services/ai` are unchanged by this phase — the
  new domain model consumes their existing output, it doesn't alter them.
- Editing a quote's analysis in the dashboard and clicking "Recalculate"
  calls the same `calculateWindowCleaningEstimate()` the estimator uses,
  with whatever pricing rules are current at that moment — there is still
  exactly one pricing implementation.
- Data does not survive across browsers/devices/private windows — it's
  `localStorage`, not a database. Acceptable for this phase; flagged as a
  known limitation, not hidden.
