# 0023 — Guided capture, evidence quality & customer confirmation (Vision V1.1)

**Status:** Accepted

## Context

With the real Anthropic pipeline working end-to-end (see ADR 0022), a real
human test surfaced the next problem: a townhouse photographed from across
the street, with shrubs obscuring several windows, actually had 14 windows.
The AI detected roughly 6. Encouragingly, Tallyvis already recognized the
evidence was thin and asked for closer photos — the tester just didn't
provide them.

This phase builds the next layer on top of the existing architecture:
`AI observes → evidence assessed → AI asks for better photos when needed →
customer confirms/corrects the pricing-relevant facts → deterministic
pricing prices it → business review is the exception, not the default`.
No new AI architecture, no fine-tuning, no change to the pricing boundary.

## A. What the "ask for closer photos" mechanism actually was

Traced before changing anything. `/estimate/result` already showed a
"We need a little more information" banner whenever
`analysis.metadata.confidence === "low"`, with body text taken from
`metadata.notes?.[0]` — the FIRST entry of an unordered list mixing
`reconcile.ts`'s own fallback-reason notes (`"Window count: the AI wasn't
confident enough..., so it defaulted to X"`) and the provider's free-text
`warnings`. There was no dedicated evidence-quality signal distinct from
per-field confidence — the tester's "closer photos" guidance was an
accidental byproduct of whichever note happened to land first, not an
intentional feature. Retry state was already sound: `input.photos` lives
in `EstimatorProvider` React state at the `/estimate/*` layout level (never
unmounted between wizard steps), so "Add another photo" → `/estimate/photos`
→ back through the wizard → re-analyze already included the ORIGINAL
photos alongside new ones — nothing needed fixing there.

## B. New: structured evidence assessment

`RawPropertyObservation` gained one new field, `evidence`:

```
coverage: "complete" | "partial" | "insufficient"
overallEvidence: "sufficient" | "usable_with_uncertainty" | "insufficient"
issues: ("distance" | "vegetation" | "vehicles" | "glare" | "darkness" |
         "blur" | "cropped_facade" | "unrelated_images")[]
```

Deliberately no separate `distance`/`visibility` scalar fields alongside
`issues` — an issue tag already conveys that information without a second
classification to keep in sync. Validated with the same soft-degradation
policy ADR 0022 established: a malformed `evidence` object degrades to a
conservative `{coverage: "partial", overallEvidence: "usable_with_
uncertainty", issues: []}` rather than rejecting the whole analysis.

The tool schema and prompt (`providers/anthropic.ts`) were extended to
request this, with the single most important new prompt rule: **the model
must never report `windowCount` as `"observed"` when it knows coverage is
incomplete** — it must use `"uncertain"` instead, paired with an honest
`overallEvidence`. This is enforced by the prompt, and independently
backstopped in code (see F below) for a model that doesn't follow it.

## C. Guided capture UX

`industry-config.ts`'s `photoIntro`/`photoGuidance` rewritten to a short,
concrete nudge ("Start with a full view... then closer photos of each
side... a few branches or a parked car are fine...") rather than a
photography tutorial — same `/estimate/photos` page, same rendering, just
different copy reflecting that real customer photos are commonly
imperfect and that's expected.

## D/E. Follow-up-photo requests: deterministic, not generative

`services/ai/src/evidenceMessages.ts`'s `describeEvidenceGaps()` maps
`evidence.issues`/`coverage` to fixed, reviewed copy ("The shrubs may be
blocking part of the lower facade — a closer photo from a different angle
would help"). **Deliberately not a second LLM call** — the brief asked to
"keep the output constrained/safe," and a small, fully-tested mapping from
a bounded set of structured tags is safer, cheaper, and faster than asking
a model to generate customer-facing prose on every analysis. If genuinely
open-ended guidance is ever needed, that's a separate, deliberate decision.

This function is computed **server-side**, inside `analyzePublicPropertyAction`
(`apps/app/src/lib/publicActions.ts`), not client-side — a real build
failure (not a guess) showed that importing a real function from
`@tallyvis/api` into a `"use client"` component pulls the whole package,
including its Postgres driver, into the browser bundle. The resulting
`string[]` crosses the server/client boundary as plain data, the same way
`analysis`/`observation` already did.

## F. Window-count semantics: never present a partial count as the total

Two layers, so this can never depend solely on the model following
instructions:

1. **Prompt**: told explicitly not to report `windowCount` as `"observed"`
   when coverage is incomplete.
2. **Code backstop** (`reconcile.ts`): if the model reports `windowCount`
   as `"observed"` anyway while `evidence.overallEvidence === "insufficient"`,
   a note is force-added distinguishing what was clearly seen from the
   property's actual total, AND the reconciled `confidence` is forced to
   `"low"` regardless of the model's own claim — `confidenceFromEvidence()`
   is combined with the existing `downgradeConfidence()` via whichever is
   MORE conservative, never the more optimistic.

No separate "clearly observed count" vs. "estimated total" schema field
was added — `ObservedValue<number>`'s existing status (`observed`/
`uncertain`/`unknown`) combined with `evidence` already expresses this
distinction; adding a second numeric field would duplicate it for no
product benefit, and the brief explicitly asked for the smallest useful
representation.

## G. Multi-photo reconciliation

Audited first, per the brief. Architecturally already correct as of ADR
0022 — every photo is one `image` content block in a single
`messages.create` call, never one request per photo, so there was never a
"sum independent per-photo counts" bug. This phase adds one new prompt
instruction: identify photos that don't appear to show the same property
(`unrelated_images` in `evidence.issues`) — the one multi-photo gap ADR
0022 hadn't covered.

## H/I. Customer confirmation UX and field policy

New `/estimate/confirm` step, inserted between `/estimate/analyzing` and
`/estimate/result` (only when an AI observation exists — the manual-entry
path, which never had anything AI-derived to confirm, still goes straight
to `/estimate/result` unchanged). No developer concepts reach the customer
(no confidence numbers, no field-status jargon) — only a stepper for
window count, pill groups for stories/access/screens/tracks/hard-water
staining, and natural-language field labels.

Limited to the fields with actual pricing effect —
`packages/pricing/src/windowCleaning.ts` was audited directly:
`windowCount`, `stories`, `accessibility`, `screens`, `tracks`, and
`hardWaterStaining` each drive a real line item or multiplier;
`condition` and `windowType` currently drive **none** (confirmed by
grep — `condition` isn't referenced in the pricing engine at all, and
`windowType` only ever displays as a hardcoded "Double-hung" label on the
result page). Both are deliberately excluded from confirmation — asking a
customer to confirm a field the pricing engine never reads would cost time
against the "10-30 seconds" goal for nothing.

Per-field attention tier (`tierFor()`), derived directly from the AI's own
`ObservedValue` status/confidence — never a second confidence model:

- `observed` + `high confidence` → shown pre-filled, no forced interaction
  (lightweight "looks right" framing).
- `observed` + lower confidence, or `uncertain` → pre-filled with the AI's
  best guess, visually flagged "Please confirm," not blocking.
- `unknown` on a pricing-critical field → no assumed default accepted
  silently; blocks "Continue" until the customer actually interacts with
  that control.

## J. Business escalation: `needs_review` finally wired up

`needs_review` and `more_information` already existed as `QuoteStatus`
values with a complete dashboard workflow — badge styling
(`quoteStatusCopy.ts`), a filter, and `QuoteActions`' approve/send/
request-more-info/reject buttons — but every quote was hardcoded to
`"new"` regardless of how uncertain its analysis was, so `needs_review`
was unreachable. `services/api/src/services/quotes.ts`'s new
`determineInitialQuoteStatus()` is the one place that now decides:

- No AI observation at all (manual entry) → always `"new"` — already
  human-reviewed by whoever typed it in.
- Confirmed analysis confidence isn't `"high"` → `"needs_review"`.
- `evidence.overallEvidence !== "sufficient"` → `"needs_review"`, even if
  confidence claims otherwise (belt-and-suspenders — confidence is
  derived from evidence today, but this doesn't assume that stays true).
- Otherwise → `"new"`.

Applied uniformly to both `createQuote` (business dashboard) and
`createQuotePublic` (customer estimator) via their shared
`persistPricedQuote` tail — no new input field needed; every signal this
function reads was already flowing through `CreateQuoteInput`.

## K. Business automation settings — deliberately not built this phase

Investigated per the brief; no per-business "automatic send" vs.
"always review" setting exists (no such column, no such UI). Building one
is real, standalone scope — a new `businesses` column, dashboard settings
UI, and a gate wired through `persistPricedQuote`. Not built this phase.
What IS in place: `determineInitialQuoteStatus()` is a small, pure,
independently-testable function specifically so a future per-business
toggle can call it conditionally (or skip it and force `"new"`) without
touching its internal logic. V1's default, applied uniformly to every
business today, is the conservative one described in J.

## L. Pricing safety preserved

Unchanged from every prior phase: `packages/pricing` was not touched by
this phase at all. The confirmation page only ever edits
`analysis.characteristics` client-side, in the same place a customer's
values already lived; `/estimate/result` still recomputes the estimate
through `calculateEstimate()`, and `persistPricedQuote` still
recomputes it AGAIN server-side from the resolved business's pricing
configuration before saving — a client can suggest characteristics, never
a price. Confirming a value never silently converts `unknown` into `0`;
every characteristic constructor still runs through `reconcile.ts`'s
honest, reviewable defaults first.

## M. Data model — no new columns needed

The `ai_window_count` / `customer_window_count` / `actual_window_count`
triad the brief asked for already exists, unchanged:
`quotes.ai_observation_json` (the AI's raw, never-mutated observation —
`aiObservation` is passed through to `setAnalysis` at confirmation time
exactly as it came back from the AI, never overwritten by the customer's
edits), `quotes.analysis_json` (now genuinely customer-confirmed
characteristics, since `/estimate/confirm` runs before it's ever saved,
where previously it was just the AI's auto-reconciled defaults), and
`job_outcomes.actual_window_count` (Phase 13, unchanged) for the
business's eventual ground truth. `compareObservationToCharacteristics()`
(Phase 13) already computes the AI-vs-confirmed comparison this data model
needs; nothing new was built for it.

## N. Photos remain non-persistent

Unchanged. No new photo storage, no new retention. `evidence`/`issues` are
metadata *about* photos, not the photos themselves.

## O/P. Compression audit

`imageCompression.ts` resizes to a 1568px long edge (Anthropic's own
documented "Standard" resolution tier — sending more pixels than that is
downscaled by the model anyway) and JPEG-encodes at up to quality 0.82,
stepping down only if needed to fit a 450KB budget. For a townhouse photo
taken from across the street, the more likely cause of a 6-vs-14 miscount
is the ORIGINAL photo's effective resolution on the windows themselves
(a distant subject occupies few source pixels well before 1568px ever
becomes the constraint) — not this pipeline discarding detail. No
compression change was made this phase: there is no evidence pointing at
compression specifically, and the mission explicitly asked for
evidence-backed changes only. `evidence.issues`'s `"distance"` tag is the
mechanism for flagging this class of problem going forward, and the
guided-capture copy (C) asks for closer photos up front rather than
relying on compression tuning to recover detail that was never captured.

## Q. Branding regression

Not touched by this phase — no changes to `StepShell.tsx`,
`EstimatorContext.tsx`'s embed-id handling, or `SettingsPageClient.tsx`.
The `window.self !== window.top` embed-scoping guard from the prior
session's fix is still intact (spot-checked, not modified).

## R. Tenant/security

No new client-writable input was introduced. The confirmation step edits
only `characteristics`/`metadata` already client-owned before this phase;
`persistPricedQuote` still resolves `businessId` and pricing configuration
entirely server-side and recomputes the estimate itself — a client still
cannot select another business, submit an arbitrary price, or touch
another tenant's configuration.

## S–V. See the final report in-conversation for tests/counts/commit hash.

## W. Known limitations

- No live Anthropic call validated this phase's prompt/schema changes
  against a real photo (same constraint as ADR 0022 — no real property
  photo exists in this environment). The next step is the real human
  acceptance test.
- The confirmation page's screens/tracks controls collapse an AI-observed
  count into a coarse None/Some/Most-or-all/Not-sure choice rather than a
  precise number — a deliberate simplification for the "10-30 second"
  goal, not a precision loss anywhere pricing-critical (`windowCount`
  itself keeps its exact stepper).
- No per-business automation setting yet (see K) — V1's conservative
  default applies uniformly.
- `apps/app` does have a small existing test suite
  (`src/lib/__tests__/publicActions.test.ts`) despite CLAUDE.md's phase-9
  note that it doesn't — that note predates this file and wasn't updated
  here, since correcting it is outside this phase's scope.
