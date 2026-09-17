# Tallyvis — Product Overview

**Tagline:** "Your job. Seen differently."

## What Tallyvis is

Tallyvis is an AI visual estimating and quoting platform for physical service
businesses. The initial beachhead vertical is **residential window
cleaning**, with an architecture designed to expand into pressure washing,
gutter cleaning, roofing, landscaping, painting, junk removal, solar,
property maintenance, and other physical service industries.

## Core workflow

1. Customer requests a quote
2. Customer uploads photos
3. Customer answers guided questions
4. Tallyvis analyzes the property
5. AI identifies structured job characteristics
6. The business's pricing rules are applied to those characteristics
7. Customer receives an estimate
8. Customer can accept/book

## The core architectural principle

**AI does not invent the price.**

AI is responsible for determining structured job characteristics (window
count, window type, pane count, stories, screens, tracks, accessibility,
condition, hard-water staining, estimated labor, etc.). The business's
pricing engine — configured by the business, not the AI — turns those
characteristics into a price. This separation is enforced in the codebase:
see `docs/architecture/overview.md` and the root `CLAUDE.md`.

## Product philosophy: knowing when it doesn't know

The system is designed to eventually support confidence-aware behavior:

- **High confidence** → automatic estimate
- **Medium confidence** → business review before the estimate goes out
- **Low confidence** → request additional information or photos from the
  customer

This is a target behavior, not yet implemented — see the phase roadmap in
`CLAUDE.md`. The `ConfidenceLevel` type already exists in `packages/types`
so it can be threaded through the system as this is built out.

## The long-term data flywheel

Customer photo → AI estimate → human adjustment → actual job → actual
labor/time/outcome → better future estimates.

This flywheel depends on infrastructure (a database, a review workflow) that
does not exist yet. It's documented here so every phase is built with this
end state in mind, not because it's implemented.

## What this document is not

This is not a research document. Customer discovery, pricing validation, and
go-to-market are owned by the founder, not generated here. See
`docs/research/README.md`.
