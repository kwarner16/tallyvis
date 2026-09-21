# 0012 — Secure quote sharing and the customer-facing quote experience

**Status:** Accepted (Phase 10)

## Context

`/quote/[id]`, since Phase 8, was explicitly documented as a stated
limitation rather than a hidden one (ADR 0010, ADR 0011): a quote's own
database id doubled as its only public "authorization." That was an
acceptable placeholder for a single-business prototype with no real link
delivery, but it does not hold up as a real product feature — a quote id
is a predictable, sequential-looking UUID with no revocation story, and
nothing stopped a visitor from opening any quote's page just by
constructing the URL if they ever learned or guessed an id. Phase 10's
brief is to replace that placeholder with a real access-control mechanism,
turn the read-only customer view into one where a customer can actually
respond, and give a business a real way to manage that sharing from the
dashboard — without touching the pricing engine, the authentication
system, or the multi-tenant repository/service architecture Phase 9
already established.

Also, per the roadmap reordering that motivated this phase: CLAUDE.md's
roadmap previously listed "real AI / computer vision integration" as
Phase 10. The founder/product owner (CLAUDE.md's "Product ownership"
section reserves this call to them) chose to run this customer-facing
sharing work first instead, since a business having no way to actually get
a quote in front of its customer securely was a bigger product gap than
the mock analyzer being a mock. CLAUDE.md's roadmap is renumbered
accordingly; the AI/CV work is still coming, just one slot later.

## Decision

### The share token is the credential, not the quote id

`quote_share_tokens` (migration `0002_quote_sharing.sql`) is a new table:
`id`, `quote_id`, `business_id`, `token_hash`, `created_at`, `expires_at`,
`revoked_at`. The raw token is `randomBytes(32).toString("base64url")` —
the exact same construction `auth/session.ts` already uses for login
sessions — and the database only ever stores its SHA-256 hash. A leaked
`quote_share_tokens` row alone is not a usable link, the same property
Phase 9's session design already established for login. Tokens expire 30
days after creation (mirroring a typical quote's real-world validity
window) and can be revoked immediately, independent of expiry.

`services/api/src/services/quoteSharing.ts` is the only place that turns a
raw token into data: `getQuoteByShareToken` resolves a hash to exactly one
`(quoteId, businessId)` pair or nothing — never a list, never a partial
match. There is deliberately no `businessId` or `customerId` parameter
anywhere in the public-facing functions (`getQuoteByShareToken`,
`acceptQuoteByToken`, `declineQuoteByToken`, `requestQuoteChangesByToken`)
for a caller to substitute; the token itself resolves both, so there is
nothing to forge past.

At most one active (non-revoked) token exists per quote at a time —
enforced both in the service layer (`generateShareLink` revokes the
existing one inside the same transaction before inserting a new one) and,
as the last line of defense, by a partial unique index
(`quote_share_tokens(quote_id) WHERE revoked_at IS NULL`). "Regenerate" is
just calling generate again.

### The raw token is shown exactly once — same trade-off as an API key

Because only the hash is stored, there is no way to read an existing
link's raw token back out later. `generateShareLink` returns it once, at
creation; `getShareLinkStatus` (what the dashboard polls on every page
load) only ever returns `{ active, createdAt, expiresAt }` — enough to
show "a link exists, generated on this date" without the link itself.
`ShareQuotePanel` (`apps/app/src/components/dashboard/ShareQuotePanel.tsx`)
surfaces this plainly: right after generating, it shows the URL with a
"copy this now, it won't be shown again" notice; on a later visit with an
already-active link, it shows status and a Regenerate/Revoke pair instead
of a URL. This is the same trade-off most API-key management UIs make,
and it was chosen over storing the raw token (which the brief for this
phase explicitly steered away from: "do not store raw long-lived bearer
tokens unnecessarily if a hash can be used").

### Business-side preview doesn't need the token at all

"Preview the customer-facing quote" (a Phase 10 requirement) could have
meant handing the business a real share link to open. Instead,
`/dashboard/quotes/[id]/preview` is a plain `requireContext()`-guarded
dashboard route — the same authorization boundary every other
`/dashboard/*` page already enforces — that renders the exact same
`CustomerQuoteView` component the public page uses, fed with data fetched
through the authenticated `getQuote(db, session, id)` rather than a
token. This means preview works before a share link even exists, never
needs the token to be re-derived, and can never leak the token to a
network request. `CustomerQuoteView` itself
(`apps/app/src/components/quote/CustomerQuoteView.tsx`) is intentionally
presentational — it never fetches anything and never decides
authorization — so one component serves both audiences without either one
being able to reach the other's capabilities: it accepts an optional
`actions` prop, and only the real public page supplies one.

### Customer actions reuse the existing status graph — no new statuses

The brief's example lifecycle (Draft → Ready → Sent → Accepted/Declined)
already existed, unchanged, in `QUOTE_STATUS_TRANSITIONS`
(`packages/types`) since Phase 8's ADR 0010 documented `new` as "Draft,"
`approved` as "Ready," and `sent`/`accepted`/`declined` as themselves.
Nothing about the status enum or its transition graph changes in this
phase. `acceptQuoteByToken`/`declineQuoteByToken` call the exact same
`canTransitionQuoteStatus` check `services/quotes.ts`'s session-scoped
`updateQuoteStatus` already enforces, so a customer can only ever accept
from `sent`, and both `accepted`/`declined` stay terminal — the graph
itself prevents a double-accept or an accept-after-decline without any
extra guard code.

**Request changes has no status of its own.** `more_information` already
exists and is business-owned (used by the dashboard's "Request more
information" action — meaning the business needs something from the
customer, the opposite direction). Rather than overload it or invent a
new value in an enum three ADRs deep, "request changes" is persisted as
two new nullable columns on `quotes`: `changes_requested_at` and
`customer_request_note`. It's a single slot, not a message thread —
sending it again overwrites the note and timestamp, which fits this
phase's "don't overengineer" instruction and the fact there's no
messaging infrastructure yet for either side to reply within.

### Customer activity tracking

`quotes` gained four more nullable columns: `first_viewed_at`,
`last_viewed_at`, `accepted_at`, `declined_at`. `first_viewed_at` is set
once (via `COALESCE`, so it can never move) the first time
`getQuoteByShareToken` successfully resolves a token; `last_viewed_at`
updates on every resolution. `accepted_at`/`declined_at` are set inside
`repositories/quotes.ts`'s `updateQuoteStatus` itself, the same function
every other status change already goes through, again via `COALESCE` so
they can't be overwritten by some later, unrelated status update.
`ShareQuotePanel` surfaces all of this directly on the quote detail page:
whether it's been viewed, when, and the most recent request-changes note
if any — answering the brief's "the business should be able to tell
whether the quote has been viewed and whether the customer responded"
without a separate analytics system.

### What did NOT change

- `calculateEstimate()` remains the only pricing entry point.
  `CustomerQuoteView` renders `estimate.lineItems`/`subtotal`/`total`
  exactly as `services/api` already computed and persisted them — nothing
  in `apps/app` recalculates a price for display.
- `Quote.pricingConfigId` still pins the exact configuration version a
  quote was priced under; nothing in this phase touches
  `packages/pricing` or `services/pricing.ts`.
- The public estimator's `getDefaultPublicBusiness` "first business"
  resolution (ADR 0011's stated Phase 9 simplification) is untouched and
  out of scope here — a share token identifies its quote, and through it
  its owning business, directly through the `quote_share_tokens` row.
  Nothing about quote sharing depends on "which business is default."
  Real multi-business public routing for the *estimator* (a slug/subdomain
  per business) remains a separate, later follow-up.
- Authentication, sessions, the repository/service layering, and
  multi-tenant `business_id` scoping are all unchanged; every new
  repository function scoped by a caller-supplied id takes `businessId`
  as a parameter and puts it in the query itself, the same rule Phase 9
  established.

## Consequences

- `packages/types`' `Quote` gained six optional fields
  (`firstViewedAt`/`lastViewedAt`/`acceptedAt`/`declinedAt`/
  `changesRequestedAt`/`customerRequestNote`) — additive, not breaking.
- The old `/quote/[id]/page.tsx` route, `getQuotePublic`,
  `getQuoteByIdAnyBusiness`, and `getBusinessForPublicQuote` are deleted,
  not deprecated in place — every consumer moved to the token-based
  equivalent in the same change, so nothing insecure was left reachable
  alongside the new mechanism.
- `services/api/src/db/migrations/0002_quote_sharing.sql` adds one table
  and six columns; both were verified against a clean database and the
  existing seeded dev database before this phase was considered done.
- Known gaps, stated rather than hidden: no email/SMS delivery of the
  share link yet (a business copies/sends it manually); no verification
  that whoever holds a valid, unexpired token is actually that quote's
  customer (the token itself is the only credential, same trust model a
  password-reset link uses); "request changes" is a single note, not a
  conversation. All explicitly future work.
