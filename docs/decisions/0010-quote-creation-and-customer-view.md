# 0010 — Business-initiated quote creation and the customer-facing quote view

**Status:** Accepted (Phase 8)

## Context

Every quote before this phase came from one place: a customer finishing the
`/estimate/*` wizard. That covers the product's core loop, but a real window
cleaning business also quotes jobs from a phone call or a site visit, before
any customer ever touches the estimator. Phase 8's brief is to turn the
pricing infrastructure Phases 6–7 built into a usable quote workflow for the
business itself — which means a business-initiated creation path, a review
step before saving, and enough of a customer-facing presentation to make
"send this quote" a believable next step, without building the sending
infrastructure that belongs to a later phase.

## Decision

**Business-initiated quote creation reuses `createQuote()` unchanged.**
`apps/app/src/app/dashboard/quotes/new/page.tsx` collects the same shape of
input the customer estimator already produces — `Customer`, `Property`,
`ServicePreferences`, `WindowCleaningCharacteristics` — and calls the exact
same `store.createQuote()` used by `/estimate/result`. There is one function
that turns "here's a job" into a priced, pinned `Quote`, regardless of which
UI collected the job. Nothing in `packages/pricing` or the store needed to
change for this; only a new form needed to exist.

**One page, not a wizard.** The customer estimator is a multi-step wizard
because it interleaves photo upload and a simulated AI-analysis wait — real
work that takes real steps. A business manually entering a job it already
knows has none of that; splitting it across routes would add friction
without adding clarity. `dashboard/quotes/new` is a single page with a live
estimate preview (recomputed via `calculateEstimate()` on every input
change, the same "instant preview" pattern `PricingPreviewTool` already
established) standing in for the separate "calculate" and "review" steps —
the business sees the price update as they type and reviews it in place
before clicking "Save quote."

**The job-characteristics field set is now shared, not duplicated.**
`CharacteristicsEditor` (correcting an existing quote's analysis) and the
new create-quote form both need the same windowCount/screens/tracks/
access/window-type fields. Rather than duplicate that markup, it moved into
`JobCharacteristicsFields`, a presentational component both now use —
`CharacteristicsEditor` wraps it with its own draft state and Save/Cancel
panel; the create-quote page controls it directly. `showStories` lets the
create-quote page suppress the field where it would otherwise disagree with
the story count already collected in its Property section.

**No new "draft" status.** The brief's example lifecycle (Draft → Ready →
Sent → Accepted → Declined) maps onto the `QuoteStatus` Phase 5 already
built (`docs/decisions/0008-quote-domain-model.md`) without adding a
parallel status axis: nothing is persisted as a `Quote` until "Save quote"
is clicked, so the in-progress form _is_ the draft — there's no saved
entity that needs a `draft` status of its own. Once saved, a quote starts
at `new` (the same initial status a customer-submitted quote gets, since
`createQuote()` doesn't know or care which UI called it) and is editable
through every non-terminal status via the existing "Edit analysis" action,
now joined by a symmetric "Edit customer" action
(`store.updateQuoteCustomer()`) for fixing contact details — which never
re-prices the quote, since customer info doesn't feed pricing.
`approved` functions as "Ready"; `sent` remains an application-state label
only, not a real delivery event, exactly as already documented on the quote
detail page's action copy.

**A quote's pricing provenance is now visible, not just stored.**
`store.getPricingConfigurationById()` is a small new export (the store
already held every configuration version; nothing could read one back by
id before this) that both the quote detail page and the create-quote
preview use to show "Priced under pricing configuration version N" —
completing the point of pinning `pricingConfigId` in the first place.

**The customer-facing quote view is a read-only foundation, deliberately
not a delivery channel.** `apps/app/src/app/quote/[id]/page.tsx` renders
business identity, the customer's name, property summary, line items, and
total — nothing a visitor can edit, no status-transition controls. It's
reachable at `/quote/[id]`, a route the dashboard's quote detail page links
to ("View as customer"). This is explicitly _not_ secured: `quote.id` is an
unguessable-but-unauthenticated token, and there is no check that whoever
holds the URL is actually that quote's customer. That's an acceptable gap
for a single-business prototype with no accounts or real link delivery yet
— sending the link by email/SMS, and verifying who's allowed to view it,
both require infrastructure intentionally deferred past this phase. The
limitation is stated in the route's own file comment, not hidden.

## Consequences

- `packages/types`, `packages/pricing`, and `packages/config` are unchanged
  by this phase — Phase 8 is entirely an `apps/app` wiring and UI phase on
  top of infrastructure Phases 6–7 already finished.
- `apps/app`'s store gained two new exports
  (`getPricingConfigurationById`, `updateQuoteCustomer`) and no new stored
  shape — `DashboardData` is identical to Phase 7's.
- The customer-facing route is a foundation, not a finished feature: no
  email/SMS delivery, no customer authentication, no way for a customer to
  respond (accept/decline) from that view yet. Those are explicitly future
  work, not silently missing.

> **Superseded (Phase 10):** the `quote.id`-as-access-token model above and
> the "no way to respond" gap are both addressed by
> `docs/decisions/0012-secure-quote-sharing.md` — a dedicated share-token
> mechanism at `/quote/[token]`, and accept/decline/request-changes actions
> on that page. Email/SMS delivery and customer authentication remain
> future work.
