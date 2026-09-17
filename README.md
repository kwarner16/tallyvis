# Tallyvis

**Your job. Seen differently.**

Tallyvis is an AI visual estimating and quoting platform for physical
service businesses. Beachhead vertical: residential window cleaning.
Customers upload photos, Tallyvis's AI identifies structured job
characteristics, and the business's own pricing rules turn those into an
estimate — AI never invents the price.

See `docs/product/overview.md` for the full product spec and
`docs/architecture/overview.md` for how the codebase is organized.

## Status

**Phase 1 (Foundation) complete.** This repository currently contains the
monorepo scaffolding, shared types, a working pricing engine for the
window-cleaning vertical, and a minimal marketing site shell — no real AI,
no database, no auth yet. See `CLAUDE.md` for the full phase roadmap.

## Getting started

This is a pnpm + Turborepo monorepo. You need Node.js 20+.

```bash
corepack enable        # one-time, provisions the correct pnpm version
pnpm install
pnpm dev                # runs apps/web in dev mode
```

Other useful commands:

```bash
pnpm build       # build all apps
pnpm test        # run all package tests
pnpm lint        # lint all packages
pnpm typecheck   # typecheck all packages
```

## Repository structure

```
apps/web        Marketing website (Next.js)
apps/app        Customer/business app (stub — Phase 4+)
packages/types  Shared TypeScript types (the AI ↔ pricing contract)
packages/pricing  Pure pricing calculation logic, fully unit-tested
packages/config   Service-vertical configuration
packages/ui     Shared React components
services/ai     AI provider abstraction (interface only — Phase 7+)
services/api    Backend API (stub — Phase 4+)
docs/           Product spec, architecture, decision records, research
```

## Environment variables

Copy `.env.example` and fill in real values as each phase introduces them —
see the comments in that file for which phase needs which variable. Never
commit a file with real secrets.

## Contributing conventions

See `CLAUDE.md` for module boundaries, labeling conventions for
mocks/stubs, and the phase roadmap.
