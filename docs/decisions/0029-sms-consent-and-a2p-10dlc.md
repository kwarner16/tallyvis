# 0029 — Explicit customer SMS consent for Twilio A2P 10DLC registration

**Status:** Accepted

## Context

ADR 0028 added the first SMS sending capability to Tallyvis: an optional
alert to a *business's own* configured notification number when a new
quote comes in. Twilio's A2P 10DLC registration process (required before
any production SMS traffic is allowed at meaningful volume/reliability)
requires proof of a compliant customer opt-in mechanism and a documented
answer for how STOP/HELP keywords are handled, even though — as the audit
below found — no code path in this repository sends an SMS to a *customer*
yet at all.

## What was found (audited before writing any code)

- **No customer-facing SMS send path exists.** `sendSms` (the one function
  every SMS send in this codebase goes through) has exactly one caller,
  `quoteSmsAlert.ts`'s `sendNewQuoteSmsAlert`, which texts the *business's*
  own `notification_phone` — never a customer's number. There was nothing
  to retrofit a consent check into; the deliverable here is the consent
  *capture and storage*, plus the eligibility *gate* ready for whenever a
  customer-facing SMS feature is actually built.
- **No inbound Twilio webhook exists.** Only `/api/webhooks/stripe` exists
  under `apps/app/src/app/api/webhooks/`. There is no STOP/HELP handling of
  any kind in this codebase today — reported here explicitly rather than
  silently building a custom inbound-webhook/opt-out-state subsystem, which
  would have been a large, unrequested addition.
- The public estimator's contact step (`apps/app/src/app/estimate/review/page.tsx`)
  is the single place a customer's phone number is ever collected — the
  manual-entry fallback and the AI-confirm path both reuse this same step,
  so there was exactly one UI location to add a checkbox to, not several.
- `createCustomerForBusiness` (`services/api/src/services/customers.ts`) is
  the one function that creates a `Customer` row from the public,
  unauthenticated estimator — always a fresh row, never matched against an
  existing customer (see ADR 0011). This made it the natural, single place
  to record consent, rather than a separate consent-log table.

## What was built

**Consent capture (UI):** an unchecked-by-default checkbox directly under
the phone field on the estimator's contact step, using the exact
disclosure language requested, linking to apps/web's existing `/privacy`
and `/terms` pages (opened in a new tab so the wizard's in-progress state
isn't lost). Native `<input type="checkbox">` + `<label htmlFor>` pairing
— keyboard-operable and screen-reader-associated for free, no custom
widget. Entirely optional: `isContactComplete` (the function gating
whether the customer can proceed to analysis) was not touched, so
declining SMS never blocks a quote request.

**Consent storage:** three new columns on `customers`
(`sms_consent`, `sms_consent_at`, `sms_consent_source`,
`sms_consent_disclosure_version` — migration `0009_sms_consent.sql`,
`DEFAULT false`/`NULL` so no existing row is retroactively marked opted
in). The timestamp, source (`"public_estimator"`), and disclosure version
are all stamped **server-side**, inside `createCustomerForBusiness` —
never accepted as client input, and never recorded unless a real phone
number was also submitted (a checked box with no number to text is not
persisted as consent). `SMS_CONSENT_DISCLOSURE_TEXT`/
`SMS_CONSENT_DISCLOSURE_VERSION` live once, in `packages/types`, read by
both the UI (to render it) and the backend (to stamp which version was
live at the moment of consent) — bump the version string if the wording
ever changes materially.

The two authenticated, business-side customer paths
(`findOrCreateCustomer`, `updateCustomer` — the dashboard's own "New
quote"/customer-edit flows) never forward `smsConsent` to the repository
at all, even if a caller supplied it: a business entering or editing a
customer's details on that customer's behalf is not the customer
consenting, and there is no code path by which the dashboard can grant or
alter consent.

**Enforcement:** `isCustomerSmsEligible(customer)` — exported from
`services/api` — requires both `smsConsent === true` and a non-empty
`phone`. This is the one required gate for any future feature that would
text a customer; nothing calls it today because nothing sends a
customer-facing SMS yet, which is the honest state of things, not
something this ADR papers over.

**STOP/HELP:** relying on Twilio's own keyword handling rather than
building a custom webhook. `services/api/src/notifications/sms/providers/twilio.ts`
now prefers sending through a `TWILIO_MESSAGING_SERVICE_SID` over a bare
`TWILIO_FROM_NUMBER` (both still supported; the Messaging Service is
strongly preferred) — A2P 10DLC campaign registration is itself built
around a Messaging Service, and sending through one is what gets Twilio's
own default STOP/HELP keyword handling and Advanced Opt-Out enforcement
applied automatically, without Tallyvis needing its own inbound webhook or
opt-out state machine. This is **not verified against a real Twilio
account** in this environment — Kyle must confirm Advanced Opt-Out
behavior (or at minimum default STOP/HELP handling) is actually active on
his Messaging Service once one exists, and this ADR does not claim
STOP/HELP compliance beyond "the architecture is set up to rely on
Twilio's own handling, once a Messaging Service is configured."

## What was deliberately not built

No custom inbound Twilio webhook / opt-out state machine — the audit
found none exists, and building one wasn't requested; only reported as a
finding, per the task's own explicit instruction not to add a large new
subsystem without it being asked for. No consent UI in the dashboard's own
customer-creation flow (out of scope — only the customer's own
affirmative action counts as consent). No retroactive consent migration
for existing customer rows — every column defaults to "not opted in."

## Verification

`pnpm test` (12 new tests in `services/api/src/__tests__/smsConsent.test.ts`
covering all five required scenarios — checked, declined, no phone number,
a simulated pre-migration legacy row, and phone-presence-alone never
implying consent — plus the existing 635 tests, all still passing),
`pnpm lint`, `pnpm typecheck`, `pnpm build` all pass. No new npm
dependencies. Live verification (an actual customer seeing and submitting
the checkbox in a browser) was not possible in this environment — no
connected browser — so the public route given to Twilio as opt-in proof
should be spot-checked by Kyle directly before submitting it.
