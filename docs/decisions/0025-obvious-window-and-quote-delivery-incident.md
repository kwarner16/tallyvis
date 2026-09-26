# 0025 — Two production launch blockers: a lost public quote, and an AI prompt that suppressed obvious observations

**Status:** Accepted (incident audit — not a new phase)

## Context

A real human acceptance test surfaced two independent failures, both treated
as launch blockers per the incident brief. This ADR documents both full
traces, what was proven true vs. false, and the fixes — no feature work,
no pricing/Stripe changes, no validation weakened.

## Failure 1 — a completed public estimate never appeared in the business dashboard

### What was found

The quote existed. It was created at the expected time, with `needs_review`
status (correctly — this repo's dashboard `listQuotes` query has no status
filter at all; `needs_review` is always visible), but under
`business_de9131e5-ef5a-4a89-83be-6648646601db` — the OLDEST business row
in the entire production database (`created_at` earliest of every business
that exists), not any business matching the founder's own login. Three
other "Korr" businesses exist from earlier testing phases, each with its
own distinct `public_embed_id`; none of them received this quote.

### Root cause

`services/api/src/services/business.ts`'s `getDefaultPublicBusiness()` — a
long-documented, deliberate Phase 9 simplification (ADR 0011) — resolves
"whichever business signed up first" whenever the public estimator has no
resolved `embedId`. This is not itself new or hidden. What's new: a real,
reproducible way for a genuine embed session to LOSE its `embedId` and
silently fall through to that bare-estimator fallback.

`apps/app/src/app/embed/[embedId]/page.tsx` only ever calls
`persistEmbedId(id)` (a raw `localStorage` write) before redirecting into
`/estimate/property`; it never sets the React context's `embedId` state
directly. That state is only ever rehydrated by `EstimatorContext`'s mount
effect — which, since a 2026-09-24 fix for a DIFFERENT bug (a stale cached
embed id bleeding a business's branding into the unrelated bare estimator
in a LATER, unrelated tab), was gated behind
`window.self !== window.top` — "only trust the cached id while actually
rendered inside an iframe right now." Opening `/embed/[embedId]` as a
plain top-level page — exactly how a human naturally smoke-tests "the
estimator embedded on my website" by following the link directly, without
an iframe — has `window.self === window.top` for the entire session, so
the id is written but NEVER read back. Every subsequent step (analyze,
confirm, create-quote) silently resolves via `getDefaultPublicBusiness()`
instead, with no error surfaced anywhere.

A second, independent architectural gap contributed once photos are added
after landing on `/estimate/result`: the quote-creation effect there was
guarded by a plain "have we ever created one" boolean, with no way back
to UPDATE that quote once a re-analysis produced a different (often
better) result — the business would keep seeing only the first, often
worse-evidence submission forever.

### Fix

1. **`EstimatorContext.tsx`**: the embed id cache moved from `localStorage`
   to `sessionStorage`, and the `window.self !== window.top` guard was
   removed entirely. `sessionStorage`'s own per-tab-session scoping
   already prevents the ORIGINAL bug (a stale id bleeding into a later,
   unrelated tab) without needing a frame-context check, and no longer
   defeats the legitimate top-level `/embed/[embedId]` visit. The
   read/write/clear logic was extracted into three plain, injectable,
   unit-tested functions (`readCachedEmbedId`/`writeCachedEmbedId`/
   `clearCachedEmbedId`) — this test environment has no real DOM
   (`environment: "node"`, matching `imageCompression.test.ts`'s existing
   pattern), so these are exercised against an in-memory fake storage.
2. **`updateQuotePublic`** (new, `services/quotes.ts`) — the re-analysis
   counterpart to `createQuotePublic`, called from `/estimate/result`
   whenever `analysis` changes AFTER a quote already exists for this
   session. Re-derives `status` (unlike the authenticated
   `updateQuoteAnalysis`, which never touches status) since a
   customer-driven re-analysis can genuinely resolve the evidence gap
   that caused `needs_review` in the first place. Scoped by
   `business_id` exactly like every other public-quote operation;
   `quoteId` itself is a random UUID this same browser already received
   from its own earlier `createPublicQuoteAction` call, never rendered in
   a URL — the same trust boundary `createPublicQuoteAction` already
   establishes, not a weaker one.
3. **`/estimate/result/page.tsx`**: replaced the `hasCreatedQuote` boolean
   with a ref tracking the exact `analysis` object last submitted, so a
   genuinely new analysis (not just a re-render of the same one) always
   fires — as a create when no quote exists yet, an update when one does.

### What was NOT changed

`listQuotes`'s query (no status/date/customer filter exists — confirmed by
reading it, not assumed), entitlement (never gated quote creation/viewing
on the public path — confirmed, not assumed), and `getDefaultPublicBusiness`
itself (the documented Phase 9 fallback stays; the bug was losing a real
embed id, not the fallback's existence).

## Failure 2 — an obvious, close-up single window produced no usable observation

### What was found

Traced via two real-provider diagnostics (not mocked — see
`services/ai/scripts/`), both confirming the same root cause:

- `scripts/verify-prompt-reasoning.mjs` asked the model, in plain text, to
  explain what the CURRENT prompt told it to report for a described
  "one indoor close-up photo, one clearly visible, unobstructed window,
  nothing else visible" scenario. Its own answer: `"uncertain"`, quoting
  the prompt's own line — *"windowCount should only be observed when I'm
  confident the visible windows are the property's total; here, that
  confidence doesn't exist, so uncertain is correct **even though the
  single window itself is seen with total clarity**."*
- `scripts/verify-window-count-against-real-api.mjs`, against real
  synthetic test images (a minimal hand-written PNG encoder — no real
  customer photos exist in this environment), showed the SAME effective
  behavior in actual structured tool-use output: a maximally-obvious
  single window produced `windowCount: { status: "uncertain",
  confidence: "medium" }` with **no `value` field at all** — not the
  literal string `"unknown"` the report described, but functionally
  identical: zero usable count reached the business.

This is exactly Part 7's option **F**: the model didn't fail to see the
window, and nothing downstream (reconciler/validator) discarded a valid
observation — the prompt itself instructed the model to withhold
"observed" status for windowCount unless it could ALSO vouch for the
property's whole total, which a single, non-overview photo can never
satisfy by construction. This confirms Part 9's suspected semantic
mismatch exists: `windowCount` was being asked to answer two different
questions — "what's visible in the submitted photos" and "what's the
property's true total" — with only one status field to carry both, and
the prompt resolved that conflict by suppressing the one thing the photos
actually proved.

### Fix

`services/ai/src/providers/anthropic.ts`'s `SYSTEM_PROMPT` rule for
`windowCount` was rewritten: it now answers ONLY "how many distinct window
openings are clearly visible in the photos actually provided" — "observed"
with a real count is correct even from a single close-up photo. Whether
the photos show the WHOLE property is answered SEPARATELY, entirely
through the existing (unchanged) `evidence.coverage`/`evidence.overallEvidence`
fields and `warnings` — never by downgrading windowCount's own status.
`"uncertain"` is now explicitly defined to still require a best-guess
`value` ("this number might be off," never "no number"); `"unknown"` is
reserved for genuinely no windows visible at all.

Re-running both diagnostics after the fix confirms the corrected
behavior end-to-end against the real API:

| Case | Before | After |
|---|---|---|
| A — one obvious window | uncertain, no value | **observed, value 1** |
| B — three windows | uncertain, no value | **observed, value 3** |
| C — partial/cropped coverage, 2 visible | uncertain, no value | **observed, value 2**, coverage flagged insufficient |
| D — obscured window | uncertain, no value | observed, value 1 (existing "still tell it's one window opening" rule, unchanged) |
| E — no windows | unknown | unknown (unchanged — correct) |

This matches the incident brief's own stated target exactly: *"I can
clearly see 1 window. I cannot determine the whole-property total from
this photo"* is now the reported behavior, not *"unknown; I see
nothing."*

A second, compounding gap was found and fixed in the same pass: even when
a real request DOES reach Anthropic and get a structured response back,
`AiProviderResult.meta` previously only ever carried Anthropic's own
`request-id` when a call THREW (`AiProviderError.detail`) — a
successful-but-suspicious response had no way to be traced back to a
specific call afterward. `meta` now also carries `requestId`
(`response._request_id`, populated by the SDK itself), `stopReason`, and
`toolUseFound` on every call, success or failure, threaded into the
existing dev-only structured log line (`logAnalysisEvent`) — still never
logging photos, prompt text, or the raw response body.

### Diagnostic mechanism (Part 6)

`services/ai/src/index.ts`'s new `maybeWriteDiagnosticImages()` writes the
EXACT compressed bytes about to be sent to Anthropic to a local directory,
for visually comparing "original photo" against "what Anthropic actually
received." Off by default; requires `AI_DIAGNOSTIC_IMAGE_DIR` to be
explicitly set (never set in any deployed environment) AND is hard-blocked
whenever `NODE_ENV === "production"` regardless of that variable —
defense in depth, not just documentation. Writes to local disk only,
never a database row, never a network call; never logs the image content
itself (only a directory path and a count). Dev/benchmark-only, as
requested.

### What was proven NOT to be the cause

- The compressed-image pipeline itself (`imageCompression.ts`'s resize/
  JPEG-encode/data-URI path) was not implicated — the real-API test used
  the exact same `data:image/...;base64,...` shape the production pipeline
  produces, and the model DID receive and correctly parse the test
  images (it counted them correctly once the prompt was fixed); the
  failure was never about image legibility.
- `reconcile.ts`/`validateRawPropertyObservation` never discarded a valid
  observation — the raw tool-use output itself already lacked a usable
  count; there was nothing valid to discard.
- The tool schema itself was not malformed and tool_use was consistently
  present (`toolUseFound: true` in every real-API test run).

### Semantic audit (Parts 9–10, reported, not changed further)

`windowCount` now consistently means "visible in the submitted photos" —
confirmed the SAME meaning is used by the AI schema/prompt (fixed here),
`reconcile.ts` (already operates on the AI's own per-field status, no
independent assumption), customer confirmation (`/estimate/confirm` just
edits whatever number is presented), and the pricing engine (prices
whatever `characteristics.windowCount` says, with no opinion on whether
it's a total or a visible-subset). No caller currently ASSUMES the
opposite meaning — confirmed by reading each one, not assumed. The
window-UNIT definition (bay/multi-sash counts as one, doors and glass
sidelights excluded, individual panes never counted) was already present
in the prompt and is unchanged by this fix; it was not part of this
incident.

**Benchmark harness caveat (Part 12), documented not rewritten**:
`computeBenchmarkMetrics`'s `avgRawRecall` compares the AI's `windowCount`
(now honestly "visible in these specific photos") against
`groundTruth.windowCount` (the property's real total) — for a
deliberately partial-coverage benchmark case, this metric will now read
LOWER than before (more cases now pass the `status === "observed"` filter
and enter the calculation, each systematically undercounting a total they
were never shown), even though the AI's counting is now MORE accurate,
not less. A code comment documents this; the harness itself was not
rewritten, per the incident brief's own "do not rewrite until semantics
are established."

## Consequences

- `services/ai`'s `AiProviderResultMeta` gained `requestId`/`stopReason`/
  `toolUseFound`; `AnalysisLogEvent` gained the same three fields.
- `services/api`'s `quotesRepo` gained `updateQuoteFromReanalysis`;
  `services/quotes.ts` gained `updateQuotePublic`; `publicActions.ts`
  gained `updatePublicQuoteAction`.
- `EstimatorContext.tsx`'s embed-id cache moved from `localStorage` to
  `sessionStorage` — no other persisted-draft behavior changed.
- A new `services/ai/scripts/` directory holds this incident's own
  reproducible, real-API verification scripts (never run in CI, require a
  real `AI_PROVIDER_API_KEY`) and `maybeWriteDiagnosticImages`'s Part 6
  diagnostic mechanism lives in `services/ai/src/index.ts`, gated off by
  default and hard-blocked in production.
- 20 new tests: `apps/app` +8 (5 `EstimatorContext` storage-function tests,
  3 `updatePublicQuoteAction`), `services/ai` +8 (2 `anthropic.ts`
  prompt/request-id, 6 `maybeWriteDiagnosticImages`), `services/api` +4
  (`updateQuotePublic`) — **570 total tests** across the workspace, all
  passing, alongside clean lint/typecheck/build. `pnpm audit` unchanged (7
  pre-existing dev-tooling advisories, none touched by this change).
