# 0005 — Ship the mock analyzer in Phase 4, not Phase 7

**Status:** Accepted (Phase 4)

## Context

The original roadmap put "AI abstraction / mock analyzer" at Phase 7, after
the pricing engine (Phase 6) and business dashboard (Phase 5). Phase 4 is
the customer estimator workflow, which the product spec requires to be a
genuine end-to-end journey: photos in, a real estimate out, computed by
`packages/pricing`. That journey cannot function with `services/ai`
throwing "not implemented."

## Decision

Implement a real, deterministic, heuristic mock inside
`services/ai/src/index.ts` now, rather than inventing a separate mock inside
`apps/app`. The `AnalyzeProperty` signature and `PropertyAnalysisResult`
shape (both already defined in Phase 1) do not change — only the function
body does. When real computer vision is built, it replaces this function's
implementation without touching any caller.

The mock:

- Is intentionally simple and commented as non-real (it does not look at
  pixel data at all).
- Uses photo count to derive a confidence level (fewer photos → lower
  confidence), so the confidence-aware paths in the estimator are exercised
  by realistic use rather than only by deliberately-crafted test input.
- Leans on the customer's self-reported story count as a heuristic input
  via a new optional `PropertyMetadata.customerDeclaredStories` field —
  explicitly commented that a real model should verify this independently
  rather than trust it.

## Consequences

- The Phase roadmap in `CLAUDE.md` is updated: Phase 4 delivers the mock
  analyzer; the old Phase 7 slot is now "real AI / computer vision
  integration" only.
- `packages/types` gained one new optional field
  (`PropertyMetadata.customerDeclaredStories`) to support the heuristic.
  This is additive and does not break any existing caller.
- Future real-AI work replaces `mockAnalyzeProperty`'s body; the interface
  boundary this ADR relies on already existed from Phase 1's design.
