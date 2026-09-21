# CLAUDE.md — Tallyvis project conventions

This file orients any Claude Code session (or other engineering agent)
working in this repository. Read `docs/architecture/overview.md` and
`docs/product/overview.md` too — this file is conventions and rules, those
are the fuller picture.

## What Tallyvis is

An AI visual estimating and quoting platform for physical service
businesses. Beachhead vertical: residential window cleaning. See
`docs/product/overview.md` for the full product spec.

## The one rule that matters most

**AI does not invent the price.** AI (`services/ai`) outputs structured job
characteristics. The pricing engine (`packages/pricing`) turns
characteristics + business-configured rules into a price. Never let a
change blur this line — e.g., never have `packages/pricing` call an AI
provider, and never have `services/ai` compute a dollar amount.

## Repository structure

```
apps/web       Marketing website (Next.js) — live in Phase 1
apps/app       Customer/business app (Next.js) — customer estimator live in
               Phase 4; authenticated business dashboard backed by
               services/api since Phase 9
packages/types Shared types — the AI/pricing/domain contract. Depends on nothing.
packages/pricing  Pure pricing logic. Depends only on packages/types.
packages/config   Vertical config (default rules, vertical registry, demo business).
packages/ui    Shared React components + theme.css. Depends only on React.
services/ai    AI provider abstraction (analyzeProperty). Mock implementation
               since Phase 4; real computer-vision backing is a future phase.
services/api   Backend: SQLite persistence, authentication, and the
               multi-tenant authorization boundary. Real since Phase 9 — see
               docs/decisions/0011-persistence-auth-and-multi-tenancy.md.
               apps/app imports it directly (in-process, not over HTTP) from
               Server Components/Actions only, never from client components.
docs/          Product, architecture, decisions (ADRs), research
```

## Module boundary rules

1. `packages/pricing` must never import from `services/ai`, `services/api`,
   any app, or any database/HTTP library. It stays pure and unit-testable.
2. `services/ai` must never import from `packages/pricing`, `services/api`,
   or any app.
3. Both depend only on `packages/types` for their shared contract.
4. `apps/web` and `apps/app` stay separate Next.js apps — do not merge them
   into one app with route groups. See `docs/decisions/0002-app-separation.md`.
5. Vertical-specific behavior (window cleaning today) belongs in
   `packages/config` and `packages/types`' discriminated unions, not as
   hardcoded branches scattered through app code.
6. `services/api` owns all database access. Neither `packages/pricing` nor
   `services/ai` may talk to a database. Within `services/api`, only
   `repositories/*.ts` write SQL, and only `index.ts` should be imported
   from outside the package — `apps/app` must never reach past it into
   `repositories/`, `db/`, or `auth/` directly.
7. Every business-owned table/type (`Business`, `Customer`,
   `PricingConfiguration`, `Quote`) carries a `businessId`, and every
   `services/api` service function takes a caller's `AuthSession` (never a
   bare id) so a business can only ever act as itself. Never trust a
   client-supplied `businessId`/`userId` — always derive it from a
   validated session (`apps/app/src/lib/session.ts`'s `requireContext()`).

## Labeling mocks, stubs, and future work

Anything that is a mock, placeholder, or not-yet-implemented must say so
explicitly — in code comments, in README stubs, and in conversation with the
user. Do not present a stub or mock as production-ready. Current examples:
`services/ai/src/index.ts` (a deterministic heuristic mock, clearly labeled
as such — not real computer vision), `packages/config`'s `demoBusiness` (used
only as seed/dev data since Phase 9, never a production data source), and the
public `/estimate/*` wizard's single-business resolution (a stated Phase 9
simplification pending real multi-business public routing — see
`getDefaultPublicBusiness` in `services/api`).

## Development workflow

- Package manager: **pnpm** via Corepack. Run `corepack enable` once after
  cloning, then `pnpm install`. Requires **Node ≥22.5** (for `node:sqlite`).
- `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck` —
  all run through Turborepo across every workspace package.
- First-time setup: `pnpm --filter @tallyvis/api seed` creates a demo
  business, an owner login, and sample quotes in `services/api`'s local
  SQLite file — prints the demo login to use signing in to `apps/app`. See
  `services/api/README.md`.
- Tests for a single package live next to it
  (`packages/pricing/src/__tests__`), not in the root `tests/` folder.
  `tests/` is reserved for future cross-package/e2e coverage. Note
  `apps/app` currently has no test suite of its own — its business logic
  lives in `services/api`, which carries the corresponding coverage
  (including multi-tenant authorization tests).
- Secrets never get committed. `.env.example` documents the shape of future
  configuration with comments; real values go in untracked `.env.local`
  files. Phase 9 authentication needs no secret (see the ADR).

## Phase roadmap

Build incrementally — do not jump ahead without a strong architectural
reason. Current phase: **Phase 12 (Real-world AI validation & estimator
refinement) — complete.**

1. Foundation
2. Marketing website foundation
3. Interactive "See What Tallyvis Sees" demo
4. Customer estimator workflow — shipped `services/ai`'s mock analyzer here
   (originally slotted for Phase 7, see
   `docs/decisions/0005-mock-analyzer-in-phase-4.md`; that slot was reused
   once the mock analyzer moved up)
5. Business dashboard
6. Pricing engine (full business-configurable rules) — versioned
   `PricingConfiguration`, `calculateEstimate()` as the canonical entry
   point, `Quote.pricingConfigId`; see
   `docs/decisions/0009-pricing-configuration-versioning.md`
7. Business pricing configuration + estimator integration — the dashboard
   pricing UI validates and versions a business's live configuration, and
   the customer estimator prices every job against it
8. Quote creation & customer workflow — a business-initiated "New quote"
   flow in the dashboard (reusing `createQuote()` unchanged), quote
   editing, pricing-configuration provenance on each quote, and a
   read-only customer-facing quote view (originally at `/quote/[id]`,
   superseded by Phase 10 below); see
   `docs/decisions/0010-quote-creation-and-customer-view.md`
9. Real persistence, authentication & multi-tenant SaaS foundation —
   `services/api` becomes a real SQLite-backed service with real
   signup/login/logout, and every business-owned record
   (`Business`/`Customer`/`PricingConfiguration`/`Quote`) is tenant-isolated
   and server-authorized; the `localStorage` mock store is retired. See
   `docs/decisions/0011-persistence-auth-and-multi-tenancy.md`
10. Customer-facing quote experience & secure quote sharing — a dedicated,
    revocable share-token mechanism at `/quote/[token]` replaces the
    quote-id-as-authorization placeholder ADR 0010/0011 each flagged as a
    stated limitation; a polished read-only customer quote page gains real
    accept/decline/request-changes actions; the dashboard gets a
    generate/regenerate/revoke/preview share-link panel and customer
    view/response activity tracking. Reordered ahead of the AI/CV work
    below at the founder's direction — see
    `docs/decisions/0012-secure-quote-sharing.md`
11. AI estimation intelligence & property analysis foundation — the
    Phase 4 mock analyzer's `AnalyzeProperty` interface is unchanged, but
    the call moves fully server-side (`apps/app` no longer depends on
    `@tallyvis/ai` at all — only `services/api`), gains a real provider
    (Claude, via `@anthropic-ai/sdk`) alongside the mock behind the same
    `AiProvider` abstraction, and a validated, per-field-uncertain
    `RawPropertyObservation` type that a basic human-review step (the
    dashboard's "New quote" flow) shows before characteristics reach
    `calculateEstimate()`. `packages/pricing` is untouched — AI still only
    ever produces estimator inputs, never a price. See
    `docs/decisions/0013-ai-analysis-foundation.md`. A more elaborate
    review/confidence system (e.g. automatic flagging or a review queue
    for low-confidence quotes) remains future work.
12. Real-world AI validation & estimator refinement — validation and
    refinement of Phase 11's pipeline, not a new architecture: removed
    the unused `propertyType` field from `RawPropertyObservation`;
    evaluated and deliberately deferred adding `paneCount` to the AI
    schema; closed a human-review gap by adding an editable `condition`
    field to `JobCharacteristicsFields`; fixed `NewQuoteClient` silently
    overwriting a business's manual correction on re-analysis (applying
    an AI suggestion is now always an explicit "Apply to form" action);
    made per-field uncertainty visually distinct (not just differently
    worded) in `AiObservationSummary`; gave AI failures categorized,
    specific error messages instead of one generic string; added
    dev-only structured logging for every analysis attempt (provider,
    model, latency, success/failure, error category — never photos,
    prompts, or credentials); added a small synthetic (mocked, not real
    photo) test-scenario suite. No real Anthropic credentials existed in
    this environment, so no live model call was made — see
    `docs/decisions/0014-ai-real-world-refinement.md` for exactly what
    was and wasn't verified, and why the prompt changes are labeled
    proactive rather than testing-driven.
13. Data flywheel — using the real usage data Phase 9's persistence now
    captures to improve AI/pricing defaults over time
14. Billing (Phase 9 already shipped real authentication)
15. Integrations and additional verticals

## Product ownership

The founder/product owner handles customer discovery, marketing, sales, and
pricing validation. Do not fabricate customer feedback, testimonials, case
studies, logos, or revenue figures anywhere in this repo, including in
marketing copy built in later phases.
