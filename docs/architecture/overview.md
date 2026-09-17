# Architecture Overview

Tallyvis is a **modular monolith** organized as a pnpm + Turborepo monorepo.
No microservices, no Kubernetes, no distributed infrastructure — the goal is
clear module boundaries that are easy to iterate on and easy to split apart
later if and when that's actually needed.

## Repository layout

```
tallyvis/
  apps/
    web/            Marketing website (Next.js)
    app/             Customer/business application (not yet scaffolded — Phase 4+)
  packages/
    types/           Shared TypeScript types — the contract between AI and pricing
    pricing/         Pure pricing calculation logic (no AI, no UI, no DB)
    config/          Vertical configuration (window cleaning today, more later)
    ui/              Shared React components used by both apps
  services/
    ai/              AI provider abstraction (analyzeProperty) — interface only in Phase 1
    api/             Backend API (not yet scaffolded — Phase 4+)
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

Defined in `services/ai/src/index.ts`. In Phase 1 this throws — there is no
implementation yet. Phase 7 adds a mock implementation (deterministic,
labeled as a mock); Phase 8 replaces it with a real computer-vision-backed
implementation. Because everything downstream depends only on this
signature and on `PropertyAnalysisResult` (defined in `packages/types`),
that swap should not require changes to the pricing engine or the UI.

## What's deliberately deferred

- **Database**: no engine chosen yet. Leading candidate is Postgres with a
  TypeScript ORM (Drizzle or Prisma), decided when `services/api` is built
  in Phase 4+.
- **Auth/billing**: deferred to Phase 11.
- **CI/CD**: deferred until there's a second contributor or a deploy target;
  noted so it isn't mistaken for an oversight.
- **Deployment**: Vercel is the likely first target for both Next.js apps
  given "simple deployment initially," but nothing is configured yet.

See `docs/decisions/` for the reasoning behind each choice made so far.
