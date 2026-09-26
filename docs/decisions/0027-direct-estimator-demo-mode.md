# 0027 — The direct, un-embedded `/estimate` wizard is a demo, and must never persist a real quote

**Status:** Accepted (incident audit — not a new phase)

## Context

After ADR 0026's fix (a transient embed-verification error silently
falling through to the default business), the founder tested the DIRECT
TallyVis estimator (`app.tallyvis.com/estimate`, with no embed context at
all — used because Korr's own embed was temporarily down) and the
resulting quote again did not appear in the intended dashboard.

This was traced from scratch, not assumed to be the same bug. It is not:
ADR 0025/0026's fixes both concern a session that HAD an embed id and
lost it. `/estimate` (bare) never had one to begin with — this is the
architectural question the incident brief itself posed: what is `/estimate`
supposed to mean, and what should happen when there is genuinely no
business context at all?

## What was found

**Part 2** — The newest quote (`quote_cd7d6923-c796-4f44-b17f-cadb64de2809`,
created `2026-09-26T05:59:41.624Z`) landed under `business_de9131e5` (the
oldest business row) — exactly, and only, `getDefaultPublicBusiness()`'s
documented behavior ("whichever business signed up first," ADR 0011). No
lost-identity mechanism was involved; there was no identity to lose.

**Part 3** — Every public action that could resolve "no embed id" fell
back to a REAL, arbitrary business: `requirePublicBusiness`
(`publicActions.ts`) and `resolvePublicBusinessSummary` (`services/api`)
both did `embedId ? resolveEmbedBusiness(...) : getDefaultPublicBusiness(...)`.
This is precisely the "no embed id → use first/default/oldest business"
pattern the incident brief asked to be found and eliminated.

**Part 1/4 — what `/estimate` (no embed id) is actually FOR, derived from
existing evidence, not assumed:**

- `apps/web`'s marketing site (`FinalCta.tsx`, `Nav.tsx`) links its
  "Try the Estimator" call-to-action directly at `apps/app`'s bare
  `/estimate` (`ESTIMATOR_URL = ${APP_URL}/estimate}` in `apps/web/src/lib/urls.ts`)
  — i.e. this is TallyVis's own general-public product demo, not a
  business-specific quoting surface. (The separately-existing, fully
  mocked "See What Tallyvis Sees" hero animation, `HeroPreview.tsx`, is a
  DIFFERENT, purely decorative teaser — not this route.)
- ADR 0011 already said so explicitly: "It creates a quote before any
  business relationship exists from the visitor's side" — the direct
  wizard was ALREADY understood, at the time real persistence was built,
  to have no genuine business relationship to attach a quote to. The
  "resolve to whichever business signed up first" behavior was labeled a
  stated simplification then, "real multi-business public routing... out
  of Phase 9's scope" — never a deliberate design for what should happen
  once tenant isolation actually mattered (which it now does).
  Independently, `@tallyvis/config` already ships `demoBusiness`/
  `demoPricingConfiguration` — the SAME ADR's own text describes these as
  used "as `apps/web`'s standalone marketing demo, which has no
  business/account concept at all" — i.e. the codebase already has a
  precedent-setting, business-less demo pricing path; the direct
  `/estimate` wizard just wasn't using it.
- The AI analysis step itself was already confirmed business-agnostic:
  `services/api`'s `runAnalysisFor` only ever uses `businessId` as a
  de-dup cache key, never for a database lookup, pricing, or any
  business-specific behavior.

This is evidence for option **A**: `/estimate` (no embed id) is a
TallyVis product demo and must not create a real, business-attributed
quote — not options B/C/D, which would require inventing new product
surface (an explicit public identifier for the bare route, or gating it
behind authentication) with no evidence either was ever intended.

## Fix

1. **`services/api`'s `resolvePublicBusinessSummary`** no longer falls
   back to `getDefaultPublicBusiness()` — returns `undefined` immediately
   when `embedId` is absent, before any database access. (`getDefaultPublicBusiness`
   itself is untouched and still used elsewhere — by other tests as a
   generic "the business that signed up first" accessor, unrelated to
   this fallback — so it was not deleted, only stopped being reachable
   from this one dangerous call site.)
2. **`apps/app`'s `requirePublicBusiness`/`requirePublicBusinessId`** now
   require `embedId` as a real (non-optional) parameter — a caller must
   explicitly decide what to do when it's absent; there is no longer an
   internal fallback to silently inherit.
3. **Every public action branches explicitly** on `embedId` presence,
   using ONLY business-less, non-persisting data for the absent case:
   - `getPublicBusinessAction` → a clearly-labeled `{ name: "Tallyvis (Demo)", phone: "" }` summary, no database access.
   - `getPublicActiveConfigurationAction` → `@tallyvis/config`'s
     standalone `demoPricingConfiguration` directly, no database access.
   - `analyzePublicPropertyAction` → proceeds with a fixed, non-business
     de-dup key (`"public-demo"`) — the AI call itself was always
     business-agnostic, so this is a pure simplification, not a
     behavior change to the analysis itself.
   - `createPublicQuoteAction`/`updatePublicQuoteAction` → refuse
     OUTRIGHT, before any database access, with a new, honest
     `DEMO_ESTIMATE_NOT_SAVED_MESSAGE` ("This is a preview... no request
     was sent to a business. Sign up your own business...").
4. **`/estimate/result/page.tsx`** no longer attempts to create/update a
   quote at all when there's no `embedId` (rather than attempting it and
   handling the now-inevitable refusal) — and its confirmation screen,
   heading, and CTA copy are explicitly demo-labeled instead of implying
   "someone from {business} will follow up" for a business that never
   received anything (CLAUDE.md's mock/demo-labeling requirement). The
   embedded, real-business flow is entirely unchanged.

## Quote lifecycle invariant after the fix

- The direct `/estimate` wizard: full AI analysis and a real price
  preview always work; **no quote row is ever created**, for any
  business, real or fabricated.
- The embedded wizard (`embedId` present and valid): unchanged —
  analysis → confirm → result creates exactly one quote for that exact
  business, a later re-analysis updates that same quote (ADR 0025),
  `needs_review` quotes remain visible in that business's dashboard
  (unchanged, no filter exists), and ownership cannot change through
  re-analysis (ADR 0026's tenant-isolation suite, unaffected by this
  change and re-run clean).
- No code path resolves an embed-less request to any real, arbitrary
  business, ever.

## What was NOT changed

The AI prompt, image compression, evidence-quality rules, and pricing
engine — untouched. The embedded flow's resolution, persistence, and
tenant-isolation guarantees (ADR 0025/0026) — untouched and re-verified.
`getDefaultPublicBusiness()` itself — kept (other tests and any future,
deliberately-scoped use may still call it directly); only its use as an
*implicit fallback* for public-facing tenant resolution was removed.
Korr's own embed and any Cloudflare-related work — explicitly out of
scope per this mission.

## Consequences

- `resolvePublicBusinessSummary`'s behavior changed for the no-`embedId`
  case (`undefined` instead of a real business) — its one existing test
  documenting the old fallback was updated to assert the new, safe
  behavior instead.
- `apps/app/src/lib/publicBusinessErrors.ts`'s `NO_BUSINESS_CONFIGURED_MESSAGE`
  was removed — it described a state ("bare wizard, zero businesses in
  the whole database") that can no longer occur, since the bare wizard no
  longer queries the database for business resolution at all; a new
  `DEMO_ESTIMATE_NOT_SAVED_MESSAGE` was added in its place for the actual
  current no-persistence case.
- 4 net new tests (`apps/app`: demo business summary, demo pricing
  configuration, analysis without a business, refusal to persist without
  an embed id — one old test removed, five added), plus one existing
  `services/api` test updated in place to assert the new safe behavior —
  **584 total tests** across the workspace, all passing, alongside clean
  lint/typecheck/build. `pnpm audit` unchanged (7 pre-existing
  dev-tooling advisories, none touched).
