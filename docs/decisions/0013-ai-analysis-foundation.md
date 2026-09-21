# 0013 — AI estimation intelligence & property analysis foundation

**Status:** Accepted (Phase 11)

## Context

`services/ai`'s `analyzeProperty()` has existed since Phase 4
(`docs/decisions/0005-mock-analyzer-in-phase-4.md`) as a deliberately
simple, clearly-labeled mock — a heuristic based on photo count, never
looking at pixel data — behind a stable `AnalyzeProperty` interface meant
to be replaced by a real implementation "without touching any caller."
Two things about how it was actually wired needed fixing before that
replacement could be real:

1. **It was called directly from the browser.** `/estimate/analyzing`
   (a `"use client"` component) imported `analyzeProperty` from
   `@tallyvis/ai` and called it in the tab. That was harmless for a mock
   that needs no secret, but it is not an architecture a real provider
   can sit behind — an API key referenced from client code either fails
   to bundle (if read from a server-only env var, which is the only safe
   way to hold a secret) or leaks (if it were ever made public). This
   phase moves that call fully server-side, through `services/api`,
   before any real provider is introduced.
2. **There was no way to see what the AI didn't know.** The mock's output
   was always a fully-populated `WindowCleaningCharacteristics` — every
   field a concrete number, no representation of "the photo didn't show
   this." A real vision model asked to guess a window count from a
   photo where the rear of the house isn't visible should be able to say
   so, not invent a number to fill the field. This phase adds that
   representation and a real review step for it.

Everything else Phase 4–10 already built — `PropertyAnalysisResult`,
`JobCharacteristics`, `calculateEstimate()`, the confidence-aware UI
copy, the estimator's temporary blob-URL photo model — is reused, not
replaced.

## Decision

### The one rule: AI observes, `calculateEstimate()` prices

Nothing new in this phase computes a dollar amount. The pipeline is:

```
provider raw output (untrusted)
      ↓ validateRawPropertyObservation()      — services/ai
RawPropertyObservation (validated, still per-field uncertain)
      ↓ reconcileObservation()                — services/ai
PropertyAnalysisResult (= JobCharacteristics + confidence) — the exact
                                                 shape calculateEstimate()
                                                 already accepted before
                                                 this phase existed
      ↓ (business reviews/edits in the UI, unchanged from Phase 5/8)
      ↓ calculateEstimate()                   — packages/pricing, untouched
Estimate (the only place a price is computed)
```

`packages/pricing` gained zero new code and zero new imports in this
phase. `services/ai`'s `RawPropertyObservation`/`ObservedValue<T>` types
(below) are private to the AI side of that pipeline — pricing never sees
them, and nothing about this phase changes `WindowCleaningPricingRules`,
`calculateEstimate()`'s signature, or how a `PricingConfiguration` is
resolved.

### Provider: Claude, via the official SDK, behind an unchanged provider interface

No AI provider was previously selected (`docs/decisions/0004-deferred-
decisions.md` listed it "not yet evaluated"). `.env.example` had already
reserved `AI_PROVIDER`/`AI_PROVIDER_API_KEY` for this slot (originally
labeled "Phase 10," renumbered along with the rest of the roadmap by
ADR 0012) — this phase honors that existing shape rather than inventing
new configuration keys.

**Claude**, via `@anthropic-ai/sdk`, is the real provider
(`services/ai/src/providers/anthropic.ts`). It uses the SDK's vision
input (base64 image content blocks) and **strict tool use** — a single
forced tool call (`tool_choice: {type: "tool", name:
"report_property_observation"}`, `strict: true`) — rather than asking
for free-text JSON, so the model's response is structurally biased
toward the right shape before it ever reaches validation. The tool's own
JSON Schema is deliberately loose (it constrains types and enum
membership, not "value is required when status is observed" — JSON
Schema's conditional-requirement support is thin, and structured-output
grammars are not guaranteed to enforce every JSON Schema keyword); the
real enforcement is `validateRawPropertyObservation`, which never trusts
the provider's own claim of correctness. `AiProvider` (`services/ai/src/
providers/types.ts`) is the abstraction — `mockProvider` and
`createAnthropicProvider(...)` both implement it identically, and
`services/ai/src/index.ts`'s `resolveProvider()` is the only place
`AI_PROVIDER` is read. Adding a second real provider later means adding
one more file here, not touching `services/api` or `apps/app`.

`AI_PROVIDER` unset or `"mock"` (the default) uses the existing Phase 4
heuristic, now genuinely implementing the same `AiProvider` interface and
flowing through the same validate/reconcile pipeline as the real
provider — not a special-cased code path. Where the mock has no real
signal for a field (`propertyType`, `hardWaterStaining` — it never
looked at pixels, before or after this phase), it now honestly reports
`"unknown"` rather than fabricating a value, exercising the same
uncertainty path a real model would use.

### `RawPropertyObservation`: per-field uncertainty, not a single confidence score

```ts
type ObservedValue<T> =
  | { status: "observed"; value: T; confidence: ConfidenceLevel }
  | { status: "uncertain"; confidence: ConfidenceLevel }
  | { status: "unknown" };
```

Every field a provider reports (`stories`, `windowCount`, `windowType`,
`accessibility`, `condition`, `screens`, `tracks`, `hardWaterStaining`,
`propertyType`) is one of these, plus an `overallConfidence` and a
`warnings: string[]` for caveats. This is `services/ai`'s own internal
type — not added to `packages/types`, which stays the stable,
provider-agnostic AI/pricing contract it already was; `RawPropertyObser-
vation` is re-exported through `@tallyvis/api` so `apps/app` never needs
`@tallyvis/ai` as a direct dependency (see "Module boundary" below).

`reconcileObservation()` (`services/ai/src/reconcile.ts`) is the only
place uncertainty gets resolved into a concrete `WindowCleaningCharac-
teristics` value — using the same fallback heuristics the Phase 4 mock
always used (customer-declared stories, a stories-based window-count
estimate, accessibility derived from stories) — and every fallback used
is recorded as a human-readable note, never applied silently. The
model's own `overallConfidence` claim is not taken at face value: if two
or more of the fields that most affect price (`stories`, `windowCount`,
`accessibility`) were not actually `"observed"`, the reconciled
confidence is downgraded regardless of what the provider claimed.

### Validation: all AI output is untrusted external data

`validateRawPropertyObservation()` (`services/ai/src/validateObserva-
tion.ts`) is a hand-written validator — consistent with `packages/
pricing`'s existing `validatePricingRules`/`validatePricingConfiguration`
style, not a new schema-library dependency for this purpose — that
rejects: non-object input, missing fields, invalid enum values,
non-integer/negative/absurd numbers (windowCount/screens/tracks capped
at 300, stories at 6), and unrecognized `status` values, while silently
dropping any extra/unexpected fields rather than trusting them. It
accumulates every error found rather than stopping at the first.
`safeParseJson()` never throws on malformed JSON. Nothing downstream —
`reconcileObservation`, the review UI, `packages/pricing` — ever sees a
`RawPropertyObservation` that didn't pass this check.

### Module boundary: `apps/app` no longer depends on `@tallyvis/ai` at all

Before this phase, `apps/app` had `@tallyvis/ai` as a direct dependency
(for the client-side call this phase removes). That dependency edge is
deleted from `apps/app/package.json` and `next.config.ts`'s
`transpilePackages` entirely — `services/api/src/index.ts` re-exports
`RawPropertyObservation`/`ObservedValue` for the review UI's types, and
the two new orchestration functions (below) are the only way
`apps/app` reaches AI analysis. This is a strictly tighter boundary
than CLAUDE.md's existing rules required (which only forbid `services/ai`
importing back toward `services/api`/apps) — chosen so "does apps/app
import @tallyvis/ai" is a simple, permanent grep-able answer of "no."

### `services/api`: authorization and input bounds, not provider logic

`services/api/src/services/aiAnalysis.ts` has two entry points, mirroring
the exact pattern `createQuote`/`createQuotePublic` already established
in Phase 9:

- `analyzePropertyForBusiness(db, session, input)` — the authenticated
  path. `session.businessId` (from the validated cookie, via
  `requireContext()` in `apps/app`) is the only source of "which
  business"; there is no `businessId` parameter for a caller to
  substitute.
- `analyzePropertyPublic(db, businessId, input)` — the public estimator's
  path. `businessId` is resolved by the caller
  (`apps/app/src/lib/publicActions.ts`, via the same `getDefaultPublicBusiness()`
  Phase 9 already uses for `createQuotePublic`) — never invented here,
  never trusted from anything the browser asserts.

Both validate their input before doing anything else: at least one
photo, no more than 8 (mirroring — not importing, since `services/api`
can never depend on an app — `apps/app`'s existing `maxPhotos` estimator
limit), each a well-formed `data:image/...;base64,...` URI under 10 MB
decoded (mirroring the client-side cap `EstimatorContext.tsx` already
enforced, now actually authoritative). A bare `blob:` URL or a `http(s)`
URL is rejected outright — see "Photo handling" below for why only a
`data:` URI can even reach here.

### Human review: reuses the existing "Edit analysis" pattern, doesn't invent a parallel one

Phase 5/8 already built the review/correction step this brief asks for —
`CharacteristicsEditor` and `JobCharacteristicsFields` let a business
correct a quote's AI-derived characteristics before it's finalized. This
phase's new "Analyze from photos" panel in `NewQuoteClient` (the
business-initiated "New quote" flow) feeds that *same* editable form: an
optional photo picker, an "Analyze with AI" button, and on success — the
reconciled characteristics pre-fill the already-editable fields below,
and a new `AiObservationSummary` panel shows, per field, what the AI
actually reported ("Uncertain," "Not visible in photos," or a value with
a confidence badge) so the business knows what to double-check before
saving. Nothing is auto-saved; `calculateEstimate()` only ever runs
against whatever is on screen when "Save quote" is clicked, exactly like
every other quote creation path.

The public customer estimator's AI step is unchanged in front-end
behavior (still shows a confidence-aware price, still lets a low-
confidence result prompt "add another photo") — customers were never the
audience for a business-side review step, and giving an anonymous
visitor an editable characteristics form would let them steer pricing
inputs more directly than intended, not less.

### Photo handling: still temporary, still browser-only — no new storage

Photos have been browser-only `blob:` URLs since Phase 4
(`UploadedPhoto.previewUrl`, held in `EstimatorContext`, never uploaded
anywhere) — a `blob:` URL is only ever valid inside the tab that created
it, meaningless to a Node server process. This phase does not change
that model or add any object storage. Instead, right before an analysis
request — and only then — the client re-reads each photo (`fetch(blobUrl)`
+ `FileReader`, in the new `apps/app/src/lib/imageEncoding.ts`) into a
`data:` URI and sends *that* to the Server Action. The photo's bytes
cross the client/server boundary exactly once, for exactly the duration
of one analysis call; nothing persists them beyond that call completing
(see "Persistence" below). Durable, business-uploaded photo storage
remains explicitly out of scope — a real cloud object store is a later
phase's problem, not one this phase needed to solve to make AI analysis
real.

### Persistence: none new — the existing `Quote.analysis` column already does this correctly

`Quote.analysis_json` has stored a structured `PropertyAnalysisResult`
(never a raw provider response) since Phase 5/9 — this phase's output is
the exact same shape, so it already fits. No new table, no new column,
no raw prompt or raw provider response is ever written to the database.
The one thing genuinely new in-memory is the short-lived dedup cache
below, which is explicitly *not* persisted (process memory only, gone on
restart).

### Abuse/cost protection: bounds and de-duplication, not a metering system

- **Never client-callable.** The provider (and its API key) is reachable
  only from `services/ai`'s `resolveProvider()`, itself only called from
  `services/api`'s two functions above — never from a Server Action that
  takes a provider choice or credential from the client.
- **Input bounds are server-authoritative**, not just client UX (see
  `aiAnalysis.ts` above) — a client-side limit is advisory only.
- **De-duplication**, not rate limiting: `aiAnalysis.ts` keeps a
  short-lived (5 minute), process-local `Map` keyed by a hash of
  `(businessId, property, every image's bytes)`. An identical request
  within that window returns the cached result instead of re-invoking
  the provider — "avoid duplicate calls for identical analysis inputs
  when practical," read literally. This is not a distributed cache, a
  queue, or a spend cap; a determined caller can still trigger many
  *different* analyses. A real usage-metering/billing system remains
  explicitly future work (CLAUDE.md's roadmap already places billing
  later), not something this phase's "basic" cost-protection bar
  required.
- **No automatic retries anywhere** — a failed provider call fails once;
  the existing "Try again" button (`/estimate/analyzing`, unchanged) and
  the dashboard's re-clickable "Analyze with AI" button are the retry
  mechanism, exactly as before this phase.
- **A 30-second per-request timeout** (`AnthropicProviderConfig.timeoutMs`,
  via the SDK's own per-request `timeout` option) so a hung provider call
  can't hang the caller forever.

### What is and isn't verified against the real API

No Anthropic credentials exist in this development environment. What
*was* verified: `services/ai/src/__tests__/anthropic.test.ts` runs the
real `@anthropic-ai/sdk` client against a local Node `http` server
standing in for `api.anthropic.com` — proving the actual request
construction (headers, vision content blocks, forced tool use), the
SDK's typed-error mapping for 401/429/500 responses, the configured
timeout actually firing, and correct handling of a refusal, an
empty/malformed body, and a tool call missing entirely. What was *not*
verified: whether a real Claude request against this exact prompt and
tool schema reliably produces useful property observations, whether the
model consistently honors "unknown"/"uncertain" over guessing, and
real-world latency/cost. Those require a real key and real photos, and
are explicitly left for whoever configures `AI_PROVIDER=anthropic` with
one — not fabricated here.

## Consequences

- `packages/types`, `packages/pricing`, and `packages/config` are
  unchanged by this phase.
- `apps/app`'s dependency on `@tallyvis/ai` is removed entirely; its only
  path to AI analysis is through `@tallyvis/api`.
- `services/api` gains its first dependency on `@tallyvis/ai`
  (previously zero AI awareness) — a new, one-directional edge the
  existing module boundary rules already permitted.
- The public estimator's `/estimate/analyzing` page changed internally
  (photos are now converted to `data:` URIs and sent to a Server Action
  instead of calling `@tallyvis/ai` in the tab) but not in visible
  behavior or timing.
- Known gaps, stated rather than hidden: no real object storage for
  photos (still browser-only and temporary, by design this phase); no
  spend-capping/usage-metering system (bounds and de-duplication only);
  the real provider's actual analysis quality is unverified in this
  environment, as stated above.
