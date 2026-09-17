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
apps/app       Customer/business app (Next.js) — customer estimator live in Phase 4
packages/types Shared types — the AI/pricing contract. Depends on nothing.
packages/pricing  Pure pricing logic. Depends only on packages/types.
packages/config   Vertical config (default rules, vertical registry, demo business).
packages/ui    Shared React components + theme.css. Depends only on React.
services/ai    AI provider abstraction (analyzeProperty). Mock implementation
               since Phase 4; real computer-vision backing is a future phase.
services/api   Backend API. Still not scaffolded — apps/app talks to
               services/ai and packages/pricing directly from the browser
               for now (see docs/decisions/0005).
docs/          Product, architecture, decisions (ADRs), research
```

## Module boundary rules

1. `packages/pricing` must never import from `services/ai`, any app, or any
   database/HTTP library. It stays pure and unit-testable.
2. `services/ai` must never import from `packages/pricing` or any app.
3. Both depend only on `packages/types` for their shared contract.
4. `apps/web` and `apps/app` stay separate Next.js apps — do not merge them
   into one app with route groups. See `docs/decisions/0002-app-separation.md`.
5. Vertical-specific behavior (window cleaning today) belongs in
   `packages/config` and `packages/types`' discriminated unions, not as
   hardcoded branches scattered through app code.
6. `services/api` (once built) owns all database access. Neither
   `packages/pricing` nor `services/ai` may talk to a database.

## Labeling mocks, stubs, and future work

Anything that is a mock, placeholder, or not-yet-implemented must say so
explicitly — in code comments, in README stubs, and in conversation with the
user. Do not present a stub or mock as production-ready. Current examples:
`services/ai/src/index.ts` (a deterministic heuristic mock, clearly labeled
as such — not real computer vision), `services/api` (README stub only),
`packages/config`'s `demoBusiness` (a placeholder business, not a real
Tallyvis customer).

## Development workflow

- Package manager: **pnpm** via Corepack. Run `corepack enable` once after
  cloning, then `pnpm install`.
- `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck` —
  all run through Turborepo across every workspace package.
- Tests for a single package live next to it
  (`packages/pricing/src/__tests__`), not in the root `tests/` folder.
  `tests/` is reserved for future cross-package/e2e coverage.
- Secrets never get committed. `.env.example` documents the shape of future
  configuration with comments; real values go in untracked `.env.local`
  files.

## Phase roadmap

Build incrementally — do not jump ahead without a strong architectural
reason. Current phase: **Phase 7 (Business pricing configuration + estimator
integration) — complete.**

1. Foundation
2. Marketing website foundation
3. Interactive "See What Tallyvis Sees" demo
4. Customer estimator workflow — shipped `services/ai`'s mock analyzer here
   (originally slotted for Phase 7, see
   `docs/decisions/0005-mock-analyzer-in-phase-4.md`; Phase 7's slot was
   reused below once the mock analyzer moved up)
5. Business dashboard
6. Pricing engine (full business-configurable rules) — versioned
   `PricingConfiguration`, `calculateEstimate()` as the canonical entry
   point, `Quote.pricingConfigId`; see
   `docs/decisions/0009-pricing-configuration-versioning.md`
7. Business pricing configuration + estimator integration — the dashboard
   pricing UI validates and versions a business's live configuration, and
   the customer estimator prices every job against it
8. Real AI / computer vision integration (replaces the Phase 4 mock)
9. Human review / confidence system
10. Database / data flywheel
11. Payments / auth / billing
12. Integrations and additional verticals

## Product ownership

The founder/product owner handles customer discovery, marketing, sales, and
pricing validation. Do not fabricate customer feedback, testimonials, case
studies, logos, or revenue figures anywhere in this repo, including in
marketing copy built in later phases.
