# 0020 — Required service address

**Status:** Accepted

## Context

The public estimator and the dashboard's "New quote" flow both collected a
property/service address as an optional field. In practice a business
cannot perform a job without knowing where it is, and once a customer
accepts a quote the business has no reliable way to ask for the address
again — the founder directed that the service address become mandatory for
every new estimate, not just a nice-to-have.

The schema already separated two different addresses, and this phase
preserves that separation rather than collapsing it:

- `Property.address` (packages/types) — snapshotted onto the `Quote` at
  creation time via `quotes.property_address`. This is "where did we quote
  this specific job," and must never change after the fact just because a
  customer's contact details change later.
- `Customer.address` (packages/types) — a separate, currently-unused
  placeholder column on `customers.address` for a possible future "default
  address for this customer" concept. It has never been written to by any
  code path (customers are always created with `address: null`) and this
  phase does not change that — it exists only as schema headroom.

Conflating these would have meant an accepted quote's recorded job location
could silently change if the customer's profile address were edited later,
which is exactly the historical-integrity problem
`docs/decisions/0009-pricing-configuration-versioning.md` already solved
for pricing. The same principle applies here: a quote is a snapshot.

## Decision

### Application-layer requirement, not a database-level `NOT NULL`

`packages/types`' `Property.address` changed from `address?: string` to
`address: string` (required), which is enforced by TypeScript at every call
site across both the public estimator and the dashboard's "New quote" form.

Server-side, `services/api/src/services/quotes.ts` adds
`validateServiceAddress()` and calls it from `persistPricedQuote` — the
single function both `createQuote` (dashboard) and `createQuotePublic`
(public estimator) funnel through. This is the one and only enforcement
point: an attacker or a client calling either Server Action directly with a
missing, empty, whitespace-only, or absurdly long (>300 characters)
address, or one containing control characters, is rejected with a clear
`Error` message before anything is persisted. No client-side check is
trusted on its own.

`quotes.property_address` (the SQLite column) stays nullable — no
`ALTER TABLE ... NOT NULL` migration was added. SQLite's lack of `ALTER
COLUMN` means tightening this would require the same rebuild-the-table
pattern `0008_google_auth_identities.sql` used for `password_hash`, and
doing that against this environment's existing local dev data would either
destroy pre-existing quotes with a null address or require inventing a
placeholder value for them — both worse than the alternative. Instead:
every quote created from this point forward is guaranteed (by the
application-layer check above) to have a real, non-empty address, while a
handful of pre-existing local quotes from before this change keep reading
back as `address: ""` (`repositories/quotes.ts`'s `toQuote`) rather than
throwing. The `NOT NULL` constraint itself is deferred to the eventual
Postgres migration (see the `DATABASE_URL`/SQLite-vs-Postgres notes in
`.env.example` and `services/api/README.md`), at which point a real
backfill decision can be made with production data in hand rather than
guessed at now.

### Validation rules (V1 — no geocoding)

Deliberately permissive on content, strict only on shape: reject `null`/
`undefined`/non-string, empty-after-trim, over 300 characters, or any
control character; otherwise accept as-is (trimmed). No regex allowlist on
characters — real addresses use letters, digits, spaces, and punctuation
(`.`, `,`, `-`, `'`, `#`, `/`) too varied to enumerate safely, and an
allowlist that's too strict is a worse failure mode (a real customer
address gets rejected) than one that's too loose. Verifying the address is
a real, deliverable location (Google Places/geocoding or similar) is
explicitly out of scope for V1, matching the "don't overbuild" instruction
this phase was built under — `packages/config`/`services/ai` have no
address-verification capability today, and adding one is a separable,
future decision.

### UI

Both entry points (`/estimate/property` and the dashboard's "New quote"
page) now label the field "Service address" with a required marker and
"Where will the service be performed?" helper text, mark the `<input>`
`required`/`aria-required`, and gate their own "Continue"/"Save" actions on
a non-empty trimmed value client-side — purely for UX; the server-side
check above is authoritative regardless of what the client does.
`isPropertyComplete()` (apps/app's estimator-local helper, shared by the
property/review/analyzing/manual-entry steps) now requires a non-empty
trimmed address alongside property type and story count, so a customer
cannot advance past the property step, nor reach AI analysis or the manual
fallback, without one.

### Visibility

The dashboard's quote detail page, the quotes list search, and the
customer-facing token-protected `/quote/[token]` page already rendered
`quote.property.address` when present (added in earlier phases ahead of
this requirement) — this phase makes that value reliably present for every
new quote rather than changing where it's displayed. No new exposure: the
address is only ever visible to the business that owns the quote (SQLite
row-level `business_id` scoping, unchanged) and to whoever holds that
quote's own share token (unchanged from
`docs/decisions/0012-secure-quote-sharing.md`).

## Consequences

- Every quote created after this change has a real, non-empty, sane-length
  service address, on both the public and business-initiated creation
  paths, enforced server-side and impossible to bypass by calling a Server
  Action directly with a crafted payload.
- A small number of pre-existing local development quotes (from before this
  change) keep a blank address rather than being backfilled or deleted;
  they render exactly as they did before (the address section was already
  conditionally hidden when absent).
- The `NOT NULL` database constraint is intentionally deferred to the
  future Postgres migration, where a real production backfill strategy can
  be chosen with actual data rather than assumed here.
