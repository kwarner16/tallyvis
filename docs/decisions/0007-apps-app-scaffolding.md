# 0007 — apps/app scaffolding: shared theme, cross-app linking, no backend yet

**Status:** Accepted (Phase 4)

## Shared design tokens extracted to packages/ui

Phase 2/3's `docs/decisions/0001-monorepo-tooling.md` and code comments in
`apps/web/globals.css` committed to extracting design tokens into a shared
`packages/ui` stylesheet once a second app needed them. That point arrived:
tokens (ivory/charcoal/orange palette, the `fade-in`/`scan`/`scan-once`
keyframes, reduced-motion handling) now live in `packages/ui/src/theme.css`,
exported via the package's `exports` field as `@tallyvis/ui/theme.css`. Both
`apps/web` and `apps/app` import it with `@import "@tallyvis/ui/theme.css";`
in their own `globals.css`, which keeps only app-specific glue (the `body`
rule, `@source` scanning path) local to each app.

## Cross-app linking via an env-configurable URL

`apps/web` (marketing) and `apps/app` (product) are separate Next.js apps
per `0002-app-separation.md`, so a "Try the Estimator" link in `apps/web`
cannot be a same-app route — it has to be a real URL to `apps/app`. Rather
than hardcode `http://localhost:3001`, `apps/web/src/lib/urls.ts` reads
`NEXT_PUBLIC_APP_URL` (documented in `.env.example`) and falls back to
`http://localhost:3001` for local development, so a real deployment just
sets the env var. `apps/web`'s own `/estimator` stub route now redirects to
that URL instead of showing a "coming soon" placeholder, since the real
thing exists.

`apps/app` runs on port 3001 (`next dev -p 3001`) specifically so both apps'
dev servers can run simultaneously via the root `pnpm dev` without a port
clash.

## No backend yet — the browser calls services/ai and packages/pricing directly

The estimator's analysis and pricing calls happen client-side in `apps/app`
for now: `Browser → services/ai (mock) → packages/pricing`, not
`Browser → API → AI service → pricing engine → database` as the target
architecture describes. This is intentional for Phase 4 — there is no
`services/api` yet (still a README stub) and no database. Nothing here
requires secrets or credentials, so this boundary is safe today, but it is
a boundary that matters: `services/api` is where this logic moves once a
real backend exists, and neither `services/ai` nor `packages/pricing`
gained any browser- or Next.js-specific code that would make that move
harder.
