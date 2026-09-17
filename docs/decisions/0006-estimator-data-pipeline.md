# 0006 — Estimator data pipeline: CustomerInput → AnalysisResult → PricingInput → Estimate

**Status:** Accepted (Phase 4)

## Context

The customer estimator (`apps/app`) needs to combine three things that must
stay conceptually and architecturally separate: what the customer said they
want, what the (mock, for now) AI observed about the property, and the
business's pricing rules. Conflating these into one object would make it
hard to reason about, and would risk letting the UI compute pricing
directly — exactly what "AI does not invent the price" forbids.

## Decision

Four distinct stages, each with its own type:

1. **`CustomerInput`** (new, `apps/app`-local) — property facts the customer
   provides (type, stories, address) and **service preferences** (do they
   want screens/tracks/interior cleaning done — a preference, not a
   physical fact) plus their uploaded photos and notes.
2. **`PropertyAnalysisResult`** (existing, `packages/types`) — the AI's
   observed `JobCharacteristics` plus confidence/notes. Unchanged from
   Phase 1 except for the new `interiorCleaning` field on
   `WindowCleaningCharacteristics` (see below).
3. **`PricingInput`** — not a new type; it's the _value_ produced by
   `buildPricingInput(customerInput, analysisResult)`
   (`apps/app/src/lib/estimator/buildPricingInput.ts`), which reconciles the
   two: e.g., if the AI observed 12 screens but the customer didn't ask for
   screen cleaning, the reconciled input has `screens: 0` so pricing doesn't
   charge for it. The reconciled value is still typed as
   `WindowCleaningCharacteristics` — no new shared type was needed.
4. **`Estimate`** (existing, `packages/types`) — produced by the unmodified
   `calculateWindowCleaningEstimate()` from `packages/pricing`, called with
   the reconciled `PricingInput` and `packages/config`'s `demoBusiness`
   pricing rules.

## Interior cleaning extension

Step 3 of the estimator asks whether the customer wants interior window
cleaning — a real add-on service `packages/pricing` had no line item for.
Rather than compute that surcharge in the UI (which the product principle
explicitly forbids), `WindowCleaningCharacteristics` gained an
`interiorCleaning: boolean` field and `WindowCleaningPricingRules` gained
`interiorCleaningPrice: number`; `calculateWindowCleaningEstimate` adds an
"Interior cleaning" line item when both are set. This is a small, additive
extension to the real pricing package, not a parallel pricing
implementation.

## Price range display

The customer-facing estimate can show a range (e.g. "$285–$325") rather
than one exact number. Rather than making `packages/pricing` fuzzy —
which would contradict "pricing is deterministic business math, not a
guess" — the range is a pure presentation-layer function
(`apps/app/src/lib/estimator/estimateDisplay.ts`) of the _real_ confidence
level already in the architecture: high confidence shows the exact total,
medium widens it by ±8%, low by ±15%. The band width is a direct, documented
function of confidence, not an arbitrary visual effect, and
`packages/pricing`'s output stays exact and unchanged.

## Consequences

- `packages/pricing`'s test suite required matching fixture updates
  (`interiorCleaning`/`interiorCleaningPrice`) plus one new test case; no
  existing test's expected numbers changed.
- Any future backend (`services/api`) reimplementing this flow server-side
  should keep the same four-stage shape — it's what makes swapping the mock
  analyzer for a real one, or adding a real business-configuration system in
  Phase 5, additive rather than a rewrite.
