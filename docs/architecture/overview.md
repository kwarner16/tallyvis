# Architecture Overview

Tallyvis is a **modular monolith** organized as a pnpm + Turborepo monorepo.
No microservices, no Kubernetes, no distributed infrastructure — the goal is
clear module boundaries that are easy to iterate on and easy to split apart
later if and when that's actually needed.

## Repository layout

```
tallyvis/
  apps/
    web/            Marketing website (Next.js, :3000)
    app/             Customer estimator app (Next.js, :3001) — live since Phase 4
  packages/
    types/           Shared TypeScript types — the contract between AI and pricing
    pricing/         Pure pricing calculation logic (no AI, no UI, no DB)
    config/          Vertical configuration (window cleaning today, more later) + demo business
    ui/              Shared React components + theme.css, used by both apps
  services/
    ai/              AI provider abstraction (analyzeProperty) — mock implementation since Phase 4
    api/             Backend API (not yet scaffolded — apps/app calls services/ai
                     and packages/pricing directly from the browser for now)
  docs/              Product, architecture, decisions, research
  public/            Static marketing assets (images, video, misc)
  scripts/           Repo-level automation (empty in Phase 1)
  tests/             Cross-package / e2e tests (empty in Phase 1)
```

## Module boundaries (enforced by dependency direction)

- `packages/types` depends on nothing. Everything else may depend on it.
- `packages/pricing` depends only on `packages/types`. It must never import
  from `services/ai`, `apps/*`, or any UI/database library. This is what
  makes "AI does not invent the price" an architectural fact rather than a
  convention someone can accidentally violate.
- `packages/config` depends only on `packages/types`. It holds vertical-specific
  data (default pricing rules, the vertical registry) so verticals are added
  by adding config, not by branching logic throughout the app.
- `services/ai` depends only on `packages/types`. It defines the
  `analyzeProperty(images, metadata)` interface that any future model
  (mock or real computer vision) implements, so swapping providers later
  doesn't touch calling code.
- `packages/ui` depends only on React. It has no knowledge of pricing, AI, or
  business logic — purely presentational, shared between `apps/web` and the
  future `apps/app`.
- `apps/web` (marketing) and `apps/app` (product) are kept as **separate
  Next.js apps** rather than route groups in one app, so the marketing site
  can be iterated on, deployed, and reasoned about independently from the
  authenticated product — see `docs/decisions/0002-app-separation.md`.
- `services/api` (not yet built) will own all database access. Neither
  `packages/pricing` nor `services/ai` may talk to a database directly.

## AI abstraction

```ts
type AnalyzeProperty = (
  images: PropertyImage[],
  metadata: PropertyMetadata,
) => Promise<PropertyAnalysisResult>;
```

Defined in `services/ai/src/index.ts`. Phase 1 shipped just the interface
(it threw); Phase 4 added a real, deterministic, clearly-labeled mock
implementation, pulled forward from its original Phase 7 slot because the
customer estimator needed something real to call — see
`docs/decisions/0005-mock-analyzer-in-phase-4.md`. A future phase replaces
the mock with a real computer-vision-backed implementation. Because
everything downstream depends only on this signature and on
`PropertyAnalysisResult` (defined in `packages/types`), that swap should not
require changes to the pricing engine or the UI.

## What's deliberately deferred

- **Database**: no engine chosen yet. Leading candidate is Postgres with a
  TypeScript ORM (Drizzle or Prisma), decided when `services/api` is built.
- **Auth/billing**: deferred to Phase 11.
- **CI/CD**: deferred until there's a second contributor or a deploy target;
  noted so it isn't mistaken for an oversight.
- **Deployment**: Vercel is the likely first target for both Next.js apps
  given "simple deployment initially," but nothing is configured yet.

See `docs/decisions/` for the reasoning behind each choice made so far.
