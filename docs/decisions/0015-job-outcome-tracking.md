# 0015 — Real-world job outcome & data collection foundation

**Status:** Accepted (Phase 13)

## Context

Phases 11–12 (ADRs 0013–0014) built and validated the AI analysis pipeline:
a provider observes a property, `reconcileObservation()` turns that into
reviewable characteristics, a human confirms or corrects them, and
`calculateEstimate()` prices the result. What happens after a quote is
priced — whether the job was actually won, what it actually took, whether
the AI's guess was actually right — was not captured anywhere. Tallyvis
does not yet have its own stream of production customers; the founder will
begin collecting real window-cleaning job data working alongside another
operator, and later from Tallyvis's own customers. This phase makes the
product capable of recording that data as it happens, so a useful
proprietary dataset can accumulate naturally — it does not train, fine-tune,
or deploy any model, and it does not change how a price is calculated.

The three things this phase must keep straight, per the brief, are the
*AI's observation*, the *human-confirmed value*, and the *actual job
outcome*. All three already existed in some form except the third; this
phase adds the third and closes a gap in how the first two were retained.

## Decision

### `job_outcomes` — one new table, additive only

`services/api/src/db/migrations/0003_job_outcomes.sql` adds a `job_outcomes`
table: one row per quote (`quote_id` is unique), holding exactly the fields
the brief names and nothing invented beyond them — actual start/end time,
actual labor minutes, actual window/screen/story counts, actual/final
price, an actual-difficulty category (reusing `AccessibilityLevel`, the
same "easy"/"moderate"/"difficult" scale `WindowCleaningCharacteristics`
already uses — not a new categorical scale), freeform notes, and
`created_at`/`updated_at`. Every field except identity/tenancy/timestamps
is nullable: a business fills in what it knows now (see "Real-world
usability" below) and can come back later for the rest — recording a
partial outcome is a first-class case, not an error state.

This table is never written to by anything that also touches
`quotes.analysis_json`/`estimate_json`/`pricing_config_id` — recording an
outcome cannot, even by omission, alter the quote's original priced
estimate. `services/api/src/repositories/jobOutcomes.ts`'s `saveJobOutcome`
only ever inserts or updates a `job_outcomes` row; `services/quotes.ts`'s
mutation functions are completely untouched by this phase.

### `quotes.ai_observation_json` — preserving the AI's raw observation

Before this phase, `RawPropertyObservation` (the AI's raw, per-field
observed/uncertain/unknown output) existed only transiently, for the
duration of one analysis call and its review — `reconcileObservation()`
consumed it and produced `PropertyAnalysisResult`, and only the
human-confirmed `characteristics` were ever saved with a quote (ADR 0014
said as much explicitly: "transient, not persisted beyond the analysis
call itself"). That meant the moment a business saved a quote, the
question "what did the AI actually see vs. what did we confirm" became
unanswerable.

`0003_job_outcomes.sql` adds a single nullable `ai_observation_json` column
to `quotes`, populated at creation time whenever AI analysis was actually
used to produce that quote (`CreateQuoteInput.aiObservation`, threaded
through both `createQuote` and `createQuotePublic` since they share
`persistPricedQuote`). It is never updated after creation — there is no
corresponding update function — so a later human correction
(`updateQuoteAnalysis`) can never retroactively alter what the AI
originally observed. A manually-entered quote (no AI, or the new public
manual-entry fallback below) simply has no observation to preserve, and
the column stays `null`.

This field was deliberately **not** added to `packages/types`' `Quote`
interface. `RawPropertyObservation` is `@tallyvis/ai`'s type, and
`packages/types` must depend on nothing (CLAUDE.md's module boundary
rules) — adding it there would mean `packages/types` importing from
`@tallyvis/ai`, inverting the dependency direction the whole architecture
relies on. Instead, `Quote` stays exactly as it was, and
`getQuoteAiObservation(db, session, quoteId)` is a sibling accessor next to
`getQuote`/`getConfigurationById` — services/api and apps/app (which
already depend on `@tallyvis/ai`'s types through `@tallyvis/api`) fetch it
alongside the quote when they need it, exactly the way a quote's pricing
configuration is already fetched as a sibling piece of data rather than
embedded in `Quote` itself.

### Comparing AI-observed vs. human-confirmed: `services/ai/src/compareObservation.ts`

Reusing rather than duplicating: `reconcile.ts` already knows how to turn a
`RawPropertyObservation` into `WindowCleaningCharacteristics`; this phase
adds one sibling pure function, `compareObservationToCharacteristics()`,
that lines the two back up field-by-field given both. It lives in
`services/ai` (not `services/api` or `apps/app`) because it is fundamentally
the same category of function as `reconcileObservation` — pure,
AI/domain-type-aware, no pricing, no persistence — and because
`services/api`'s `jobOutcomes.ts` and `quotes.ts` both need it, so it
belongs at the shared layer both already depend on.

Each field is reported as one of: `"observed"` (the AI committed to a
value — compared against what was confirmed, and flagged `corrected` if
they differ), `"uncertain"`, or `"unknown"` (the AI never committed to a
value, so nothing was "corrected," only filled in). This distinction
matters: the brief's own example — AI observes 18 windows, a human
confirms 24 — is a genuine correction; a human filling in a window count
the AI marked `"unknown"` is not "the AI was wrong," it's "the AI didn't
know," and conflating the two would misrepresent what the data actually
shows.

### The "Record actual job" workflow

`apps/app/src/components/dashboard/JobOutcomePanel.tsx`, embedded directly
in the existing quote detail page (`apps/app/src/app/dashboard/quotes/[id]`)
rather than a separate route — the brief calls for showing the original
estimate alongside the recorded outcome, and that page already has the
estimate on screen. Recording is a single form: status (in progress /
completed), actual price, actual labor (minutes, or start/end times if
known exactly — minutes alone is enough and is the field real-world usage
is expected to lean on), actual window/screen/story counts, actual
difficulty, and notes. Every field is optional and the form is the same
whether creating or updating — `recordJobOutcomeAction` always upserts,
so a business filling in more detail later doesn't create a duplicate
record.

`apps/app/src/lib/quoteActions.ts`'s `recordJobOutcomeAction` follows the
exact pattern every other mutation in that file already does:
`requireContext()` derives the business from the session cookie, and
`services/jobOutcomes.ts`'s `recordJobOutcome` re-checks quote ownership
server-side before writing anything — never a client-supplied businessId,
never an assumption that a quoteId alone proves ownership.

### Derived comparisons, kept visibly separate from raw facts

`JobOutcomePanel` computes two kinds of comparison once an outcome exists:
labor time vs. `characteristics.estimatedLaborHours`, and actual price vs.
`estimate.total` — plus, when an AI observation exists, the field-by-field
AI-vs-confirmed table from `compareObservationToCharacteristics`. All of
these are computed at render time from the raw stored facts, never stored
themselves, and rendered under a "Compared to the estimate" heading
distinct from the raw recorded values above it — never as a score,
ranking, or accuracy percentage. Section G of this phase's brief is
explicit that no accuracy claim exists without a real dataset and
methodology; this phase reports exactly zero such claims anywhere.

### `/dashboard/job-outcomes` — a list, not a dashboard

`listQuotesWithOutcomes(db, session)` returns every one of a business's
quotes annotated with its outcome (if any) and whether/how AI was
involved. The view lists ALL quotes, not just ones with a recorded
outcome — deliberately, since the point of the view is to show a business
what still needs recording, not only what's already done. A simple status
filter (All / Not recorded / In progress / Completed) is the only
interactivity; there are no charts, no aggregate statistics, no trends —
exactly the "minimal, not a full analytics dashboard" scope the brief
calls for.

### Closing the Phase 12 gap: a real manual fallback on the public estimator

Phase 12's ADR 0014 already flagged this as a known limitation: the public
estimator's AI-failure message had nowhere for a customer to actually go.
This phase adds one: `/estimate/analyzing`'s error state now links to a
new `/estimate/manual` step, which reuses the dashboard's existing
`JobCharacteristicsFields` component (no new form built) to collect the
same characteristics AI would have produced, seeded with sensible defaults
(`apps/app/src/lib/defaultCharacteristics.ts`, also now shared by the
dashboard's "New quote" flow, replacing what used to be a locally-defined
duplicate). Submitting sets `analysis` in `EstimatorContext` — the exact
same context slot a successful AI analysis sets — with `confidence: "low"`
and a note stating manual entry was used, and no `aiObservation` (`null`,
not omitted: "AI wasn't used here" is itself a meaningful, honestly
recorded fact). `/estimate/result` does not know or care whether `analysis`
came from AI or a human; it recomputes the estimate server-side through
the same `calculateEstimate()` call either way, and `createQuotePublic`'s
own server-side validation applies unconditionally. An AI failure can no
longer prevent a customer from getting a priced estimate and submitting a
quote.

### What was NOT built

No model training, fine-tuning, or evaluation infrastructure. No vector
database. No autonomous pricing — `packages/pricing` has zero diff this
phase, confirmed by `git diff --stat`. No photo retention (still out of
scope, per ADR 0013's "Photo handling"). No production analytics platform
— the job-outcomes view is one filtered list with a detail comparison, not
a BI tool. No accuracy claims, percentages, or scoring of any kind.

## Consequences

- `packages/types`' `Quote` interface is unchanged — `aiObservation` lives
  as a sibling accessor (`getQuoteAiObservation`), not a field on `Quote`,
  specifically to avoid `packages/types` depending on `@tallyvis/ai`.
- `CreateQuoteInput` (services/api) gained one new optional field,
  `aiObservation` — additive, no existing caller needed to change.
- `AnalyzePropertyResult` and `AnalyzePropertyInput` are unchanged;
  `analyzePublicPropertyAction`'s return type widened from
  `PropertyAnalysisResult` to the full `AnalyzePropertyResult` (adding
  `observation`) — the public wizard still doesn't display it, but now
  threads it through `EstimatorContext` to preserve it.
- Known gaps, stated rather than hidden: no photos are retained alongside
  a preserved AI observation (only the structured per-field observation
  itself), so a future "why did the AI think this" review still can't show
  the original photo; the job-outcomes list has no pagination (fine at
  today's scale, would need revisiting at real volume); `actual_difficulty`
  reuses `AccessibilityLevel` rather than a dedicated "how the job actually
  went" scale, which was a deliberate reuse decision but means it can't
  capture a difficulty reason distinct from access (e.g., unusually dirty
  windows) — notes exists for that today.
