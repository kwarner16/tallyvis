# 0009 — Pricing configuration versioning and the canonical pricing entry point

**Status:** Accepted (Phase 6)

## Context

Phase 5 gave every quote a `PropertyAnalysisResult` and an `Estimate`, but the
rate card behind that `Estimate` was a single, unversioned
`WindowCleaningPricingRules` object living on `DemoBusiness` — editing it in
the dashboard's Pricing page mutated the one object in place. That was fine
for "does the dashboard's rate card affect the next estimate" (Phase 5's
question), but it breaks down for "full business-configurable rules"
(Phase 6's brief): a business needs to be able to change its prices without
silently rewriting the price on every quote that already exists, and the
product needs a well-defined place to enforce that a rate card is actually
valid before it's trusted.

## Decision

**Pricing configuration is a separate, versioned object, not a bare rate
card.** `PricingConfiguration` (`packages/types`) wraps `PricingRules` with
identity and versioning fields — `id`, `businessId`, `industry`, `currency`,
`version`, `effectiveAt`. `version` is monotonically increasing per business
and a saved configuration is never mutated in place: `apps/app`'s mock store
(`apps/app/src/lib/quotes/store.ts`) keeps every version a business has ever
saved in an array, and saving an edited rate card appends a new version
rather than overwriting the current one. This mirrors how `Quote` and
`JobCharacteristics` already live in `packages/types` as the shared
AI/pricing/dashboard contract rather than being invented ad hoc in an app.

**`Quote.pricingConfigId` pins the exact configuration version used to price
it.** Every `Quote` records which `PricingConfiguration.id` produced its
`estimate`, set once at creation and never silently changed. This is what
makes "a business changing its prices does not retroactively change quotes
that already exist" an actual property of the system instead of a comment:
because old versions are kept (not discarded on save), a quote's pinned id
always resolves to the rate card that was active when it was priced, even
after the business has since saved newer versions.

This pinning also disambiguates two different dashboard actions that could
otherwise be confused with each other:
- **Editing a quote's analyzed characteristics** (`updateQuoteAnalysis`) —
  correcting what a job involves — re-prices against the *same* pinned
  configuration the quote already had. Fixing a window count should not also
  silently pull in today's prices.
- **Recalculating a quote** (`recalculateQuoteEstimate`) — an explicit,
  separate action a business takes when it wants an existing quote repriced
  under its *current* rules. This one re-prices against the active
  configuration and re-pins `pricingConfigId` to it, since the business is
  deliberately opting that quote into the new rate card.

**`calculateEstimate()` is the single canonical pricing entry point.**
`packages/pricing`'s `calculateEstimate(characteristics, configuration,
confidence)` validates the configuration (via `validatePricingConfiguration`)
before pricing, then dispatches to the vertical-specific function
(`calculateWindowCleaningEstimate` today). Every real, persisted pricing
decision in the product — the customer estimator, quote creation and
recalculation, seeded demo data — goes through this function instead of
calling `calculateWindowCleaningEstimate` directly, so there is exactly one
place that decides "given this business's configuration, what does this job
cost," and a malformed configuration is caught before it reaches an estimate
rather than after. The one deliberate exception is the dashboard's pricing
preview tool: it previews the rate card currently being *edited* (possibly
unsaved, not yet a persisted configuration), so it wraps that in-progress
draft in the currently-active configuration's envelope and still prices it
through `calculateEstimate()`, rather than reaching for the vertical function
directly.

**Two layers of validation, for two different failure modes.**
`validatePricingRules()` and `validatePricingConfiguration()`
(`packages/pricing`) return an itemized `PricingValidationResult` —
every field-level problem, not just the first one — so a UI could show a
business owner everything wrong with a rate card at once. This is distinct
from `calculateWindowCleaningEstimate`'s internal `assertSanePricingInputs`
guard, which throws on the first NaN/negative/missing value it finds: that
guard exists so the math itself never silently produces garbage, regardless
of whether the caller validated first. `calculateEstimate()` runs the
itemized validation up front and throws with all of the errors joined
together if the configuration is invalid, which should only happen if a
configuration was corrupted or constructed by hand outside the normal save
path.

## Consequences

- Historical quote reproducibility is real, not just documented: a quote's
  `estimate` and the `PricingConfiguration` version that produced it can
  both still be retrieved after the business has since changed its prices,
  because old versions aren't discarded.
- `apps/app`'s mock store now holds a small version history
  (`pricingConfigurations: PricingConfiguration[]`) instead of one mutable
  rate card. This is still `localStorage`, not a database — the same known
  limitation as Phase 5's `docs/decisions/0008-quote-domain-model.md` — and
  the shape of this history is deliberately simple (an append-only array,
  "active" = the last entry) since a real backend's versioning needs are not
  yet known.
- `packages/pricing` and `packages/types` gained no AI-, HTTP-, or
  database-specific code from this — `calculateEstimate()` is as pure as
  `calculateWindowCleaningEstimate()` was, just with an extra validation step
  and a vertical dispatch in front of it.
