# 0022 — Graceful partial AI analysis (the reliability-rejection bug)

**Status:** Accepted (Phase 12.1 — a production reliability fix, not a new phase)

## Context

Commit `8560f2e` fixed the tool-schema bug (`value` using an empty `{}`
JSON Schema) that had been making every real Anthropic call fail
identically. After that fix, real inference started working — Anthropic is
contacted, a real `report_property_observation` tool call comes back, and
it validates as valid JSON — but the real human estimator test still did
not complete. The production user-facing result was:

> Analysis failed. The AI's analysis didn't look reliable, so it was
> discarded.

This is a different failure class from the schema bug, and this ADR
documents its root cause and fix.

## Root cause

`apps/app/src/lib/aiErrorMessages.ts` maps that exact sentence to
`AiErrorCategory: "invalid-response"`. That category is thrown from exactly
one place: `services/ai/src/index.ts`'s `runAnalysis()`, when
`validateRawPropertyObservation()` (`services/ai/src/validateObservation.ts`)
returns `{ ok: false }`.

Tracing that function as it existed before this fix: it validated all
eight `ObservedValue<T>` fields (`stories`, `windowCount`, `windowType`,
`screens`, `tracks`, `accessibility`, `condition`, `hardWaterStaining`) plus
`overallConfidence` and `warnings`, and pushed a description into a single
shared `errors` array for *any* problem with *any* field — a field missing
its `confidence` when `status` was `"observed"`/`"uncertain"`, an
out-of-range or wrong-typed `value`, an unrecognized `status`, a missing
`overallConfidence`, or a malformed `warnings` array. The function then
rejected the **entire observation** if `errors.length > 0`, with no
distinction between "the whole response is garbage" and "one of eight
fields had a formatting slip."

Nothing downstream imposes a separate confidence-threshold or
reliability-score gate — `reconcile.ts`'s `reconcileObservation()` never
rejects anything; it only resolves per-field uncertainty into reviewable
defaults and downgrades the reported `overallConfidence` when core fields
(`stories`/`windowCount`/`accessibility`) are unresolved.
`compareObservation.ts` is purely a post-hoc comparison tool with no
gating role. **The all-or-nothing schema validator in
`validateObservation.ts` was the entire reliability policy** — and it was
stricter than the tool schema sent to Anthropic ever guaranteed: the tool
schema (`providers/anthropic.ts`) deliberately only requires `status` on
each `ObservedValue` object (not `confidence`, not `value`), because
Anthropic's strict tool-use JSON Schema support can't express "`confidence`
is required only when `status` is `observed`/`uncertain`." A model that
followed the tool schema exactly (e.g. an `"observed"` field with a
`confidence` it considered redundant, or a field it left with the
minimum-required `status` alone) could produce a perfectly reasonable
response that this validator still discarded wholesale.

This is consistent with what production showed: a real, successful
Anthropic call producing a real, useful structured observation, discarded
anyway because the all-or-nothing gate found one field it couldn't parse.

## Decision

`validateRawPropertyObservation()` now distinguishes two severities:

- **Hard rejection** (`ok: false`, still `AiErrorCategory: "invalid-
  response"`) — only when there's no per-field data to salvage at all: the
  raw input isn't even a JSON object, or its `vertical` doesn't match
  `"window-cleaning"`.
- **Soft degradation** (`ok: true`) — any individual field that's
  malformed in any way (missing/invalid confidence, invalid enum/number,
  unrecognized status, wrong shape) is replaced with the honest `{status:
  "unknown"}`, and a specific, non-technical note is appended to the
  result's `warnings` (e.g. `The AI observed "screens" but didn't give a
  valid confidence level, so it was treated as unknown.`). Every other
  field survives untouched. A missing/invalid `overallConfidence`
  similarly defaults to `"low"` (the conservative choice) rather than
  voiding the response — `reconcileObservation()`'s existing
  `downgradeConfidence` logic already distrusts an unsupported "high" claim
  based on how many core fields actually came through observed, so this
  default composes correctly with logic that already existed.

This required no changes to `reconcile.ts` or the review UI
(`AiObservationSummary.tsx`) — both already handled individual
uncertain/unknown fields gracefully (fall back to a reviewable default,
downgrade confidence, render a visually distinct "not visible" state); they
simply never got the chance to, because the validator discarded the whole
response before reconciliation ever ran. The public estimator's result page
(`/estimate/result`) already shows a non-blocking "We need a little more
information" banner when `metadata.confidence === "low"` — exactly the
right treatment for a heavily-degraded-but-still-useful analysis, and
already in place before this fix.

**Unchanged:** `packages/pricing` is not touched by this fix at all. AI
observations remain suggestions a human reviews before
`calculateEstimate()` ever runs; nothing here lets an unreviewed
unknown/uncertain value flow into a price.

## Safe structural diagnostics

`services/ai/src/logging.ts`'s dev-only `logAnalysisEvent()` previously
logged only the bare `errorCategory` on a validation failure, discarding
`validateRawPropertyObservation()`'s own `errors` array — there was no way
to see *why* a response was rejected from the logs alone. Two additions,
both already governed by the existing "no photos, no prompt text, no PII"
logging rule (Phase 12 — docs/decisions/0014-ai-real-world-refinement.md):

- A failed (hard-rejected) validation now logs `errorDetail`, the specific
  structural complaint (e.g. `"vertical" must be "window-cleaning" — got
  undefined.`) — now always safe to log in full, since hard rejection is
  narrow enough that these messages never echo field values.
- A successful validation now logs `observationSummary`
  (`summarizeObservationForLogging()`, new in `validateObservation.ts`): a
  compact, safe, per-field `field=status(value,confidence)` string (e.g.
  `windowCount=observed(18,high) screens=uncertain(low)
  hardWaterStaining=unknown overallConfidence=medium warnings=1`). The
  values logged here are never customer-identifying — window/story/screen
  counts, enum labels, booleans — the same category of data the review UI
  already shows a human.

## Prompt audit (window definition & multi-photo reconciliation)

Auditing `providers/anthropic.ts`'s system prompt against the questions
this fix was diagnosed against found two real gaps, both now fixed with
targeted prompt additions (not a rewrite):

- **What counts as one "window"** was never defined. The schema has a
  single `windowCount: ObservedValue<number>` field (no `paneCount` —
  deliberately deferred per ADR 0014) with no guidance on bay/bow windows,
  grouped sashes, or glass doors. The prompt now states the convention
  explicitly: one distinct framed window opening = one window; a
  multi-sash bay/bow window counts as one, not one per sash/pane; sliding
  glass/patio doors and French doors are never counted as windows.
- **Multi-photo reconciliation** was architecturally already correct —
  `buildUserContent()` puts every photo into one `messages.create` call as
  multiple `image` content blocks in a single user message, never one
  request per photo — so there was never a "sum independent per-photo
  counts" bug to fix in code. But the prompt itself never told the model
  this, leaving it free to double-count a window visible in two photos of
  overlapping angles. The prompt now states explicitly that all photos are
  views of the same property and a window visible in more than one photo
  must be counted once, not per photo.

Both additions are covered by new regression tests in
`services/ai/src/__tests__/anthropic.test.ts` that inspect the actual
request body sent to Anthropic (system prompt text, message/image-block
count) rather than trusting the source file not to regress silently.

## What remains unverified

No live Anthropic call was made to validate this specific fix. Two
reasons, together: (1) the root cause and fix are demonstrated directly
from the code path itself — `validateRawPropertyObservation`'s previous
`errors.length > 0` short-circuit is a straightforwardly incorrect
reliability policy independent of what any particular model response
contains, and the new pipeline/anthropic tests exercise the exact
shape of a real tool-use response (see `anthropic.test.ts`'s
`validToolResponse()` fixture, modeled on the real Anthropic Messages API
response shape) through the real `@anthropic-ai/sdk` client; (2) no real
property photo exists anywhere in this repository or environment to send —
Phase 13 (ADR 0015) deliberately never retains uploaded photos, and no
image fixture was committed by the earlier schema-bug diagnosis either
(also confirmed not real-photo, per that commit). Spending a live Anthropic
call against a synthetic (non-house) image would not exercise the actual
question ("does a real photo produce a useful window count that now
survives validation") and was judged not worth the cost for that reason.

**No accuracy percentage is claimed anywhere in this document.** Whether a
real Claude response for a real house photo produces an accurate window
count remains to be seen against real usage — this fix only ensures that
whatever *did* come back stops being discarded over one malformed field.
The next real step is the actual human acceptance test: re-run the exact
production flow that produced "Analysis failed" before this fix, with a
real property photo, and confirm the analysis now reaches the review step
instead of being rejected.

## Consequences

- `services/ai/src/validateObservation.ts`'s `ValidationResult.ok: false`
  path is now much narrower — callers that assumed "any schema hiccup ⇒
  full rejection" (there were none outside this package) would need to
  adjust, but nothing outside `services/ai` inspected that shape directly.
- `RawPropertyObservation.warnings` can now include validator-generated
  degradation notes alongside provider-generated warnings — both already
  rendered identically by `AiObservationSummary`'s warnings list, so no UI
  change was needed to surface them.
- `AnalysisLogEvent` (dev-only logging) gained `observationSummary`, and
  `errorDetail` is now populated on `invalid-response` failures too — pure
  additions, no existing log consumer depends on their absence.
- `packages/pricing` is unchanged.
