# 0026 — A second lost-tenant-identity regression: the re-verification path, not the storage mechanism

**Status:** Accepted (incident audit — not a new phase)

## Context

Commit `1710848` (ADR 0025) fixed one confirmed way the public estimator
could lose its embed identity (a `window.self !== window.top` guard
blocking `sessionStorage` rehydration on a top-level `/embed/[embedId]`
visit) and confirmed the AI single-window fix worked in production. A
fresh human acceptance test after deploying that commit showed the AI fix
holding, but the SAME class of symptom recurred: a completed public
estimate landed under `business_de9131e5` (the oldest business in the
database) again, not the intended Korr business.

Per the incident brief's own instruction, this was NOT assumed to be the
same bug repeating — it was traced from scratch.

## What was found

**Part 1/2** — The newest quote (`quote_5dc1837e-b87a-436a-b8b2-95393fdbc550`,
created `2026-09-26T05:39:16.306Z`, `windowCount: 1` — matching the
single-window AI test the founder confirmed worked) again belonged to
`business_de9131e5` ("Korr Window Cleaning," `kyle@tallybis.com`, the
oldest business row, `public_embed_id: 2d7b98d5987129641f00ec88`), not any
of the other two "Korr" businesses. All three Korr businesses were
explicitly enumerated (none assumed).

**Part 9** — Confirmed via Vercel deployment metadata: `app.tallyvis.com`
serves `dpl_Au8XFRjgs7bAt2xr4uqjH1AUtehV`, created 37 seconds after commit
`1710848` was committed, with no intervening commits on `main`. Production
was running the fix.

**Part 3/4** — Traced every `/estimate/*` page for `embedId` usage.
`EstimatorProvider` mounts exactly once for the whole wizard (one shared
layout), so — contrary to the first hypothesis — the fix from ADR 0025
(sessionStorage + no iframe guard) IS deployed and DOES correctly persist
a cached embed id across steps, including a top-level `/embed/[embedId]`
visit. That was not the recurrence.

The real cause, found by reading `EstimatorContext`'s rehydration effect
and `verifyEmbedIdAction` together: a cached embed id is always
RE-VERIFIED on mount (in case the underlying business was deleted since
it was cached) —

```ts
const stillValid = await verifyEmbedIdAction(storedEmbedId);
if (stillValid) {
  setEmbedIdState(storedEmbedId);
} else {
  clearCachedEmbedId(window.sessionStorage);
}
```

— and `verifyEmbedIdAction` (`publicActions.ts`) collapsed two entirely
different outcomes into the same `false`:

```ts
export async function verifyEmbedIdAction(embedId: string): Promise<boolean> {
  try {
    return Boolean(await resolveEmbedBusiness(getDb(), embedId));
  } catch (err) {
    logUnexpected("verifyEmbedIdAction", err);
    return false; // <-- an unexpected error looked EXACTLY like "invalid embed id"
  }
}
```

A transient failure (a cold-start database connection hiccup, a momentary
network blip — exactly the kind of thing a serverless function's first
invocation after idle is prone to) made a perfectly real, valid embed id
look "invalid." The context then cleared the cache and proceeded with
`embedId: null` for the rest of the session — every subsequent action
silently fell through to `getDefaultPublicBusiness()` (Part 4's exact
"dangerous default fallback" scenario), with no error surfaced anywhere,
on an otherwise-correctly-embedded, real-iframe session. This is a
different, independent bug from ADR 0025's — the storage/frame-guard fix
was necessary but not sufficient.

Supporting evidence: `vercel logs --since/--until` for the relevant window
showed `/embed/54b6f1ad3323666ee62d64f4` (a DIFFERENT, real Korr business's
embed id) was hit around the test time, alongside a burst of automated-
looking traffic across many unrelated routes — consistent with, though not
independently conclusive proof of, this exact failure mode (Vercel's log
retention for this project does not reach back far enough to capture the
precise request trace with certainty; this is stated as a limitation, not
overclaimed as direct proof — the code-level bug is proven by reading it
and reproduced by its test, independent of the log evidence).

**Part 5/6** — Re-confirmed (not re-assumed) unchanged from ADR 0025: the
dashboard's `listQuotes` has no filter of any kind, so it was never a
factor. `updateQuotePublic`'s business-scoping (`getQuoteById`/
`updateQuoteFromReanalysis` both require an exact `business_id` match) was
verified to make ownership reassignment structurally impossible even if a
session's resolved business changed between create and update — a new
end-to-end test proves this against two real businesses, not just a
placeholder id.

## Fix

1. **`verifyEmbedIdAction`** (`publicActions.ts`) now returns
   `boolean | null`: `true` (confirmed valid), `false` (confirmed
   invalid — the lookup completed and found nothing), or `null`
   (genuinely unknown — an unexpected error prevented the lookup from
   completing at all). These are no longer conflated.
2. **`shouldBlockEstimator(cachedEmbedIdPresent, verification)`** (new,
   pure, exported from `EstimatorContext.tsx`, unit-tested without a DOM)
   encodes the actual invariant Part 4 asked for: a session with NO cached
   embed id at all is never blocked (the documented bare-estimator
   fallback keeps working); a session that DID have a cached embed id is
   blocked by anything other than a confirmed-valid verification —
   confirmed-invalid AND unknown-error both block, neither silently
   degrades to "proceed with no tenant."
3. **`EstimatorContext`**'s rehydration effect uses this function; only a
   confirmed-invalid id (not a transient error) clears the cache, so a
   genuinely transient failure doesn't even permanently discard a real id
   — a later retry (e.g. a page reload) can still succeed.
4. **`StepShell.tsx`** (wraps every `/estimate/*` step — the single choke
   point) renders the same "This estimator isn't set up correctly" block
   used by `/embed/[embedId]` itself whenever `embedBlocked` is true,
   before any step's own content — no individual page can route around
   this, and no business-resolving action (analyze, confirm, create/update
   quote) can ever fire during a blocked session.
5. A safe, permanent, non-PII log line was added at
   `requirePublicBusiness` (the actual server-side fallback choke point)
   whenever the default-business fallback is used — this should be rare
   for real embedded traffic; if it starts appearing at volume, that is
   now directly observable rather than only inferable after the fact.

## Regression tests

- `EstimatorContext.test.ts`: 4 new tests directly encoding the
  tenant-isolation invariant (`shouldBlockEstimator`) — a bare session is
  never blocked; a confirmed-valid cached id is never blocked; a
  confirmed-invalid OR unknown-error cached id is always blocked.
- `publicActions.test.ts`: `verifyEmbedIdAction` now has 3 tests
  distinguishing all three outcomes (previously 1 test asserted the
  buggy `false`-on-error behavior; corrected to assert `null`).
- `publicEstimator.test.ts` (`services/api`): a new "tenant isolation
  end-to-end (embed A / embed B)" suite — two REAL businesses, exercised
  through the actual production functions
  (`resolveEmbedBusiness`/`createQuotePublic`/`updateQuotePublic`/
  `listQuotes`), proving: A's embed → A's quote → A's dashboard; B's
  embed → B's quote → B's dashboard, invisible to A; and — the specific
  Part 6/8 requirement — `updateQuotePublic` called with a different
  REAL business's id is refused outright ("Quote not found"), never
  reassigns ownership, and the quote remains exactly where it started.

## What was NOT changed

The AI prompt, image compression, evidence-quality rules, confirmation
flow, and pricing engine were not touched — the single-window fix from
ADR 0025 remains exactly as verified. `getDefaultPublicBusiness()` itself
(the documented Phase 9 bare-estimator behavior) was not removed or
altered — it is still correct for a session that never had any embed
context at all; only the "did we ever have one" bookkeeping was fixed.

## Consequences

- `verifyEmbedIdAction`'s public return type changed from `boolean` to
  `boolean | null` — its only two call sites (`/embed/[embedId]`'s
  landing page, `EstimatorContext`'s rehydration) were both updated;
  `/embed/[embedId]`'s own `if (!valid)` check already correctly treats
  `null` the same as `false` with no code change needed there.
- `EstimatorContextValue` gained `embedBlocked: boolean`.
- 10 new tests — 580 total across the workspace, all passing, alongside
  clean lint/typecheck/build. `pnpm audit` unchanged (7 pre-existing
  dev-tooling advisories, none touched).
