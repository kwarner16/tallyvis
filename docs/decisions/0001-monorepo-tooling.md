# 0001 — Monorepo tooling: pnpm + Turborepo, TypeScript everywhere

**Status:** Accepted (Phase 1)

## Context

Tallyvis needs multiple apps (marketing site, future customer/business app)
and multiple internal packages (types, pricing, config, ui) with strict
boundaries between them — in particular, pricing logic must never depend on
the AI layer or vice versa. This calls for a real monorepo, not a single
Next.js app with folders.

## Decision

- **Package manager:** pnpm, via Corepack (`corepack enable`) rather than a
  global install. This avoids "works on my machine" version drift and needs
  no manual pnpm installation step for a new contributor.
- **Task orchestration:** Turborepo, for caching and running tasks (`build`,
  `test`, `lint`, `typecheck`) across packages with correct dependency
  ordering.
- **Language:** TypeScript everywhere, `strict: true`. The core value
  proposition of this architecture (AI produces structured characteristics,
  pricing consumes them) depends on the compiler catching contract
  violations between `services/ai` and `packages/pricing`.

## Alternatives considered

- **npm workspaces without Turborepo:** simpler, but loses caching and
  explicit task dependency graphs once there are 5+ packages. Rejected as
  premature to avoid, not premature to adopt — Turborepo is lightweight
  config, not new infrastructure to operate.
- **Yarn:** no meaningful advantage over pnpm for this use case; pnpm's
  strict node_modules linking is a better fit for enforcing package
  boundaries (a package can't accidentally resolve a dependency it didn't
  declare).

## Consequences

- Every contributor must run `corepack enable` once after cloning. Documented
  in the root README.
- Internal packages are consumed as TypeScript source (no build step) via
  Next.js's `transpilePackages`, not as compiled `dist/` output. This is
  simpler for Phase 1 but means these packages can't yet run outside a
  bundler that understands TypeScript (e.g., a plain Node script). Revisit
  if/when `services/api` needs to consume them directly under plain Node —
  at that point add a real build step (tsup or `tsc`) to the packages it needs.
