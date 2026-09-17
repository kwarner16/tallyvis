# services/api

**Status: not yet implemented.**

This is a placeholder for Tallyvis's backend API service (request handling,
persistence access, orchestration between `services/ai` and
`packages/pricing`). It is intentionally empty in Phase 1 — there is no
estimator workflow yet for it to serve.

Expected to come online around **Phase 4** (customer estimator workflow),
once `apps/app` needs a real backend to talk to. Per the architecture
boundaries in the root `CLAUDE.md`, this service should own database access
(`packages/pricing` and `services/ai` must stay database-agnostic).
