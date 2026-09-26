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
- First-time setup: run `pnpm --filter @tallyvis/api db:migrate` first
  against your `DATABASE_URL`/`DIRECT_URL` Postgres database — required
  before `seed` (or the app itself) will work, since `getDb()` now only
  ever verifies the schema is already migrated, never applies migrations
  itself (see `docs/decisions/0021-postgres-migration.md`'s "Production
  migration strategy" addendum). Then `pnpm --filter @tallyvis/api seed`
  creates a demo business, an owner login, and sample quotes — prints the
  demo login to use signing in to `apps/app`. See `services/api/README.md`.
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
reason. Current phase: **Phase 14 (Customer onboarding, billing,
notifications & website embedding) — complete.**

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
13. Real-world job outcome & data collection foundation — a `job_outcomes`
    table (one row per quote, every field but identity/tenancy/timestamps
    optional) for recording what actually happened on a completed job,
    entirely additive and never mutating a quote's historical
    `analysis`/`estimate`/`pricingConfigId`; `quotes.ai_observation_json`
    now preserves the AI's raw per-field observation separately from the
    human-confirmed characteristics it produced (previously discarded
    after the review step — see ADR 0014's "transient" note), compared
    field-by-field via `services/ai`'s new `compareObservationToCharacteristics`;
    a "Record actual job" panel on the existing quote detail page and a
    minimal `/dashboard/job-outcomes` list (not a BI dashboard); and the
    Phase 12-flagged gap closed — the public estimator's AI-failure state
    now links to a real `/estimate/manual` fallback (reusing
    `JobCharacteristicsFields`, no new form built) so an AI failure can
    never block a customer from completing a quote. `packages/pricing` is
    untouched. See `docs/decisions/0015-job-outcome-tracking.md`. Using
    this collected data to actually improve AI/pricing defaults remains
    future work — this phase only builds the capability to collect it.
14. Customer onboarding, billing, notifications & website embedding — the
    foundation for a business to discover Tallyvis, sign up, choose a
    plan, start a 7-day no-card trial, configure, install the estimator
    on its own website, and have a customer email it back. Password
    recovery (`password_reset_tokens`, the same hashed-single-use-token
    pattern sessions/share-links already use); a small `EmailProvider`
    notification abstraction (dev-console provider + a real Resend
    integration, unverified live — no credentials in this environment)
    powering both password-reset emails and a new "email this quote to
    the customer" action that reuses the existing secure quote-share
    token mechanism unchanged; a `subscriptions` table (one row per
    business, reconcilable against Stripe) with a server-authoritative
    `hasProductAccess` gate — a business with no subscription row keeps
    legacy access, never retroactively locked out; a separate
    `billing_charges` table for the one-time website-installation fee,
    deliberately not folded into the recurring plan; a Stripe billing
    provider (real REST calls, also unverified live) plus a signature
    verified webhook endpoint; `@tallyvis/config`'s `PLANS` as the single
    plan definition apps/web's pricing section and apps/app's
    onboarding/billing both read, closing the "Get started" buttons that
    previously all dead-ended at `/contact`; and a universal
    `public_embed_id`-based website embed (`public/embed.js` + `/embed/
    [embedId]`) that resolves a business publicly without ever trusting
    or exposing its internal `businessId`, finally giving the public
    estimator the real multi-business routing ADR 0011 flagged as a
    stated Phase 9 simplification. That "fall back to an arbitrary real
    business when no embed id is given" behavior was later removed entirely
    (see ADR 0027) after it caused real cross-tenant quote leakage; the
    direct, un-embedded `/estimate` wizard is now a no-database-write demo
    instead. `packages/pricing` is untouched. See
    `docs/decisions/0016-onboarding-billing-embed.md` for exactly what
    was verified against real services (password reset, quote email via
    the dev provider, trial/access-gate logic, embed resolution, webhook
    signature/event handling against hand-built payloads) vs. what
    remains architecture-only pending real Resend/Stripe credentials.
15. Integrations and additional verticals

## Product ownership

The founder/product owner handles customer discovery, marketing, sales, and
pricing validation. Do not fabricate customer feedback, testimonials, case
studies, logos, or revenue figures anywhere in this repo, including in
marketing copy built in later phases.
