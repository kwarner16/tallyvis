# 0014 — Real-world AI validation & estimator refinement

**Status:** Accepted (Phase 12)

## Context

Phase 11 (ADR 0013) built the AI property-analysis pipeline and its
architectural boundary: provider abstraction, per-field uncertainty,
validation, reconciliation, authorization, and a human review step. It
explicitly stated what it had *not* verified: no Anthropic credentials
existed in that development environment, so the real provider adapter
was only proven against a local fake HTTP server, never a live model.

That remains true in this phase's environment too — no `.env.local` file
and no `AI_PROVIDER_API_KEY` exist anywhere in this repository or its
environment, so **no live call to the real Anthropic API was made or
could be made during this phase**. Everything below that reads as a
product/UX/schema improvement was arrived at by re-reading the Phase 11
implementation critically against this phase's brief, not by observing a
real model's behavior. Where that distinction matters, it's called out
explicitly rather than implied away.

This phase is scoped as validation and refinement of what Phase 11
built, not a new architecture: no permanent cloud photo storage, no
model training/fine-tuning infrastructure, no autonomous pricing, and no
weakening of the "AI observes, `calculateEstimate()` prices" boundary.

## Decision

### `propertyType` removed from `RawPropertyObservation` — dead schema field

Phase 11's schema asked the model to observe `propertyType`
("single-family"/"townhouse"/"other"). Re-reading the consumers: `Property.propertyType`
is a field a human enters directly when creating a quote or filling out
the public estimator (`NewQuoteClient`'s "Property type" buttons,
`/estimate/property`'s equivalent) — it was never read from
`RawPropertyObservation` by `reconcileObservation()`, and no review UI
ever displayed the AI's guess at it. It was pure model-inference cost
(one more thing the prompt asked for, one more field validated) for a
value nothing downstream consumed — exactly the "added because computer
vision can detect it" mistake this phase's brief warns against. Removed
from `RawPropertyObservation`, the validator, both providers, and every
test fixture.

### `paneCount` evaluated, deliberately left unimplemented

`WindowCleaningCharacteristics.paneCount` has a real pricing rule
(`pricePerPane` in `packages/pricing`) but has been hardcoded to `0` in
every characteristics constructor since it was introduced — never
AI-observed, never manually edited. Adding it to the AI schema was
considered and rejected for this phase: accurately counting individual
panes per window from a photo is a materially harder vision task than
the count-level fields already in the schema (window/screen/track
counts), it would meaningfully lengthen the prompt and tool schema for a
field most businesses leave at the pricing configuration's `$0` default,
and there is no real-world testing in this environment to justify the
added complexity. Deferred, not silently dropped — a future phase with
real usage data on whether businesses actually price per-pane is better
positioned to decide if it's worth the added inference burden.

### `condition` — human-review gap closed

`condition` (`good`/`fair`/`poor`) was already part of
`WindowCleaningCharacteristics`, already AI-observed and displayed in
`AiObservationSummary`, and already persisted with every quote — but
`JobCharacteristicsFields` (the shared editable form used by both
`NewQuoteClient` and `CharacteristicsEditor`) had no field for it. A
business could see the AI's guess but never correct it, which is exactly
the "human correction must be possible" gap this phase's brief calls
out. Fixed by adding a `condition` select to `JobCharacteristicsFields`,
styled identically to the existing `accessibility` select — both editors
that share this component gained the field automatically.

### The auto-overwrite bug: human correction is now genuinely authoritative

`NewQuoteClient.handleAnalyze()` previously called `setCharacteristics()`
and `setStories()` directly on every successful analysis. A business
that corrected a value after a first analysis, then re-ran "Analyze with
AI" (e.g. after adding a clearer photo), would have that correction
silently overwritten with the new AI suggestion — the exact failure mode
Phase 12's brief explicitly prohibits ("do NOT automatically rerun AI and
overwrite the user's correction"). Fixed by introducing a
`pendingSuggestion` state: a successful analysis populates it and shows
an explicit "Apply to form" / "Keep current values" choice, never
touching `characteristics`/`stories` on its own. This is true for the
first analysis as much as any later one — nothing is pre-applied by
default, so what ends up in the form (and what gets saved) is always
something a human explicitly accepted, whether that was one click after
the first analysis or ten edits later.

### Uncertainty is now visually distinct, not just differently worded

`AiObservationSummary`'s per-field rows previously differed only in text
("Uncertain" vs. "Not visible in photos" vs. a value) while sharing
identical styling — an easy value to skim past as if it were as solid as
an observed one. Each status now also carries distinct styling: an
`"observed"` value reads as plain settled text; `"uncertain"` is
italicized and accent-colored, visibly a guess; `"unknown"` is
italicized and faint, visibly absent. Nothing about a confidently
observed value and an uncertain one should be mistakable at a glance.

### Error categories: from "analysis failed" to a specific, actionable message

Phase 11's failure handling already distinguished `AiProviderError`
categories (`authentication`, `rate-limit`, `timeout`, …) internally, but
every caller collapsed them into one generic `Error` before they reached
the UI — `runAnalysis()` rethrew `new Error(err.message)`, discarding the
category, and the public estimator's `.catch()` discarded the message
entirely in favor of a hardcoded string. This phase:

- Extends `AiErrorCategory` with `too-many-images`, `image-too-large`,
  and `invalid-image` — `services/api/src/services/aiAnalysis.ts`'s input
  validation (photo count/size/format bounds) now throws a categorized
  `AiProviderError` instead of a bare `Error`, the same type providers
  already use.
- `services/ai`'s `runAnalysis()` now preserves and rethrows the
  `AiProviderError` (wrapping only genuinely unexpected non-`AiProviderError`
  throws as `category: "unknown"`), instead of flattening every failure
  into a plain `Error`.
- A Server Action can only hand a plain `Error`'s `message` back across
  the server/client boundary — custom properties like `category` don't
  survive that serialization. `apps/app/src/lib/aiErrorMessages.ts` maps
  each category to a specific, safe, user-facing sentence
  ("The AI provider is busy right now — please try again in a moment."
  for `rate-limit`, "AI analysis isn't configured for this environment
  yet." for `not-configured`, etc.); `quoteActions.ts`'s
  `analyzePropertyAction` and `publicActions.ts`'s
  `analyzePublicPropertyAction` catch `AiProviderError` and re-throw with
  that resolved message as the sole `Error.message` before it crosses the
  boundary.
- The dashboard's `NewQuoteClient` (where manual entry is already fully
  supported — every characteristics field is editable with or without
  AI) appends the exact reassurance this phase's brief specifies: "AI
  analysis unavailable — continue manually." The public estimator's
  `/estimate/analyzing` step does not — it has no manual-entry fallback
  UI today, so that specific phrase would be misleading there; it now at
  least surfaces the real categorized message instead of a hardcoded
  generic string, and keeps its existing "Try again" / "Back to photos"
  recovery actions.

### Operational visibility: dev-only structured logging, no analytics platform

`AiProvider.analyzeProperty()` now returns an optional `meta` (`model`,
`inputTokens`, `outputTokens`) alongside its raw output, and
`services/ai/src/logging.ts`'s `logAnalysisEvent()` emits one structured
JSON line per analysis attempt (success or failure) via `console.log`/
`console.error` — provider name, model, success/failure, latency,
image count, error category, and token counts when available. This is
deliberately the simplest thing that satisfies "operational visibility
as dev logging" from the brief: no new logging library, no production
analytics platform, no persistence. It never logs an API key, a photo, a
prompt, or a raw provider response — only the metadata listed above.

### Prompt improvement: a proactive clarity pass, not a response to observed failures

`providers/anthropic.ts`'s system prompt was rewritten with concrete
accessibility criteria (what specifically makes access "easy" vs.
"moderate" vs. "difficult") and explicit guidance to name a specific
obstruction in `warnings` rather than let it disappear into a bare
difficulty label. **This is explicitly not a fix for a confirmed live
model failure** — no live calls were possible in this environment, so
there is no real-world evidence a model actually struggled with the
original prompt. It's a proactive readability improvement from
critically re-reading the Phase 11 prompt, offered honestly as that and
nothing more.

### Synthetic scenario tests: mocked outputs, not accuracy claims

`services/ai/src/__tests__/scenarios.test.ts` adds eight hand-authored
`RawPropertyObservation` fixtures modeling the scenarios this phase's
brief names by example — simple single-story, two-story with mixed
window sizes, difficult access, partial obstruction, multiple visible
sides, a low-quality/ambiguous single photo, missing information filled
by the customer's declared story count, and repeated photos of the same
angle — run through `validateRawPropertyObservation`/
`reconcileObservation`. These are **not** real photos (none were
available or appropriate to commit) and **not** a claim about how a real
model performs on real photos of these kinds — they verify that the
*pipeline* (validation, fallback resolution, confidence downgrading,
note-recording) behaves correctly given a plausible mocked output shape
for each case. No accuracy percentage is claimed anywhere; see "What is
and isn't verified" below for the honest, non-percentage-based framing
this phase reports against.

## Future data-collection considerations (not built this phase)

The brief asks this phase to identify, without building, what future
data collection would need to close the loop from "AI observation" to
"verified real-world accuracy" — that closing is Phase 13's later "data
flywheel" work, per CLAUDE.md's roadmap. A clean model already exists
conceptually in today's data:

- **AI observation** — `RawPropertyObservation`, per-field, with its own
  confidence, transient (not persisted beyond the analysis call itself).
- **Human-confirmed value** — `Quote.analysis_json`
  (`PropertyAnalysisResult.characteristics`), what the business actually
  saved — already distinct from the AI's raw observation today, since a
  correction always overwrites it before saving.
- **Actual job outcome** — does not exist yet. Closing the loop would
  need, at minimum: the photos used for that analysis (not currently
  retained anywhere — see ADR 0013's "Photo handling"), the AI's raw
  per-field observation *as it was at analysis time* (also not currently
  retained — only the human-confirmed result is), actual time spent on
  the job, the quoted price vs. the final price actually charged,
  any additional work discovered on-site, and the actual job
  characteristics a technician would report after completing it
  (true window count, true accessibility, etc.).

None of this is implemented in this phase — no new table, no new
persisted field, no photo retention. It's recorded here as the shape a
future phase would need, consistent with CLAUDE.md's "Data flywheel"
roadmap entry already being a distinct, later phase.

## What is and isn't verified against the real API

Identical position to ADR 0013, unchanged by this phase: no Anthropic
credentials exist in this environment. What *was* verified this phase:
`services/ai`'s full test suite (73 tests, including the new scenario
fixtures) and `services/api`'s AI-analysis tests (13 tests, including new
assertions on the newly-categorized input-validation errors) pass
against the mock provider and the real `@anthropic-ai/sdk` client talking
to a local fake HTTP server — proving request/response handling and
error categorization, not real-world model behavior. What remains
unverified, exactly as before: whether a real Claude request against
this prompt and schema reliably produces useful, accurate property
observations; whether the model actually honors "uncertain"/"unknown"
over guessing when photos are genuinely ambiguous; real-world latency and
cost. **No accuracy percentage is claimed anywhere in this phase** —
there is no evaluation methodology or real-world test set to back one.
What can be reported instead: 8 synthetic pipeline scenarios exercised,
all producing the expected validation/reconciliation behavior; 0 live
model calls made; the specific, itemized software-correctness claims
in the "Decision" sections above.

## Consequences

- `packages/pricing` is unchanged by this phase — no AI import, no new
  pricing logic, `condition` and `paneCount` already existed as pricing
  inputs before this phase (only `condition`'s UI editability changed).
- `AiErrorCategory` (exported from `@tallyvis/ai`, re-exported through
  `@tallyvis/api`) gained three input-validation categories; any future
  caller of `analyzePropertyForBusiness`/`analyzePropertyPublic` should
  expect `AiProviderError` (not a bare `Error`) on failure and can branch
  on `.category`.
- `RawPropertyObservation` lost `propertyType` — a breaking change to
  that type's shape, but it was `services/ai`-internal (never part of
  `packages/types`) and had no real consumer, so nothing outside
  `services/ai`'s own tests needed updating.
- Known gaps, stated rather than hidden: still no live-model
  verification (no credentials in this environment); `paneCount`
  remains AI-unaware and hardcoded to `0`; no job-outcome data collection
  exists yet (see "Future data-collection considerations" above); the
  public estimator's AI-failure UX still has no manual-entry fallback to
  reassure the customer with, unlike the dashboard flow.
