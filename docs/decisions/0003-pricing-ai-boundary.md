# 0003 — Pricing/AI boundary via a shared types package

**Status:** Accepted (Phase 1)

## Context

The single most important product principle is "AI does not invent the
price." This needs to be true architecturally, not just by convention,
because it's the thing that makes the estimate trustworthy and
business-configurable.

## Decision

`packages/types` defines `JobCharacteristics`, `PropertyAnalysisResult`, and
`PricingRules` with no dependency on either `services/ai` or
`packages/pricing`. `services/ai` depends only on `packages/types` and
produces `PropertyAnalysisResult`. `packages/pricing` depends only on
`packages/types` and consumes `JobCharacteristics` + `PricingRules` to
produce an `Estimate`. Neither package imports the other. The only thing
that can wire them together is calling code one layer up (eventually
`services/api` or the estimator UI).

`packages/pricing/src/windowCleaning.ts` is real, tested logic (not a stub)
in Phase 1, specifically to prove this boundary works end-to-end before any
UI or AI implementation exists — see its test suite in
`packages/pricing/src/__tests__`.

## Consequences

- Adding a new job characteristic requires updating `packages/types` first,
  which forces both the AI side and pricing side to acknowledge the change
  (a compile error surfaces anywhere it's not handled) — this is
  intentional friction.
- `services/ai`'s Phase 1 implementation is a stub that throws, deliberately.
  It is not a mock yet (that's Phase 7) — the interface is what's being
  locked in now, not behavior.
