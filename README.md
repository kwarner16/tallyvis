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

**Phase 4 (Customer estimator workflow) complete.** The marketing site
(`apps/web`) and a real customer-facing estimator (`apps/app`) both run;
the estimator's "AI" is a clearly-labeled deterministic mock (see
`services/ai`) and there is no database, auth, or real business-account
system yet. See `CLAUDE.md` for the full phase roadmap.

## Getting started

This is a pnpm + Turborepo monorepo. You need Node.js 20+.

```bash
corepack enable        # one-time, provisions the correct pnpm version
pnpm install
pnpm dev                # runs apps/web (:3000) and apps/app (:3001)
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
apps/web        Marketing website (Next.js, :3000)
apps/app        Customer estimator app (Next.js, :3001) — /estimate/*
packages/types  Shared TypeScript types (the AI ↔ pricing contract)
packages/pricing  Pure pricing calculation logic, fully unit-tested
packages/config   Service-vertical configuration, demo business
packages/ui     Shared React components + theme.css
services/ai     AI provider abstraction — mock implementation since Phase 4
services/api    Backend API (still a stub — the estimator talks to
                services/ai and packages/pricing directly for now)
docs/           Product spec, architecture, decision records, research
```

## Environment variables

Copy `.env.example` and fill in real values as each phase introduces them —
see the comments in that file for which phase needs which variable. Never
commit a file with real secrets.

## Contributing conventions

See `CLAUDE.md` for module boundaries, labeling conventions for
mocks/stubs, and the phase roadmap.
