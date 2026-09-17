# 0002 — Marketing site and product app as separate Next.js apps

**Status:** Accepted (Phase 1)

## Context

The spec requires the marketing website to be architecturally separate from
the actual application (customer estimator, business dashboard). Next.js
supports this either as one app with route groups (e.g. `(marketing)` vs
`(app)`) or as two independent apps sharing a UI package.

## Decision

Two separate Next.js apps: `apps/web` (marketing) and `apps/app` (product,
scaffolded later in Phase 4), both consuming `packages/ui` for shared
components. `apps/app` is not scaffolded in Phase 1 — only a README stub —
since there's no product workflow yet for it to host.

## Alternatives considered

- **Single Next.js app with route groups:** less initial setup (one
  `package.json`, one deploy target), but couples the marketing site's
  build/deploy lifecycle to the product app's from day one. A marketing copy
  change would ship through the same pipeline as authenticated app code.
  Rejected because the spec explicitly calls out this boundary, and
  splitting later — once both apps have real content — is meaningfully more
  disruptive than starting split.

## Consequences

- Slightly more upfront scaffolding (two `package.json`s, two `next.config`s
  once `apps/app` exists) and two things to deploy instead of one.
- Marketing site can be iterated on and deployed independently of the
  product app, which matters more as `apps/app` grows in Phase 4+.
- Both apps must be kept in sync on `packages/ui` — a shared component
  change is a single-package edit, not a duplicated one.
