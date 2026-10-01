# 0031 — V1 customer-facing SMS messaging program

**Status:** Accepted (trigger wiring corrected 2026-10 — see "2026-10 correction" below; see also 0032 for STOP/START sync and the consent-UX hardening pass)

## Context

ADR 0029 built the consent capture/storage and the `isCustomerSmsEligible`
gate, but deliberately sent nothing — "nothing calls it today because
nothing sends a customer-facing SMS yet." Twilio's A2P 10DLC campaign
registration needs the actual messaging program (the real set of message
types, triggers, and content) to accurately describe what Tallyvis sends,
not just the opt-in mechanism. This phase builds that program: six V1
message kinds, reusing ADR 0028's `sendSms`/provider abstraction and ADR
0029's consent/eligibility gate exactly as both were designed to be reused.

## What was audited before writing any code

- `sendSms` (`notifications/sms/index.ts`) and the Twilio/dev provider pair
  were unchanged from ADR 0028/0029 and needed no modification — the
  abstraction already supported an arbitrary `to`/`body`/`kind`.
- `sendNewQuoteSmsAlert` (`quoteSmsAlert.ts`) only ever texts the
  **business owner**, never a customer, and was left untouched — this
  phase adds a parallel, separate set of customer-facing senders rather
  than modifying it.
- `isCustomerSmsEligible` and `createCustomerForBusiness`'s consent
  recording (ADR 0029) needed no changes — reused as-is.
- **No appointment/scheduling data model exists anywhere** —
  `packages/types` has no scheduled date/time field, and no "schedule an
  appointment" UI exists in `apps/app`. Confirmed by a repo-wide search for
  "appointment", which only turns up the legal pages' consent-disclosure
  copy (itself listing appointment messages as a *future* message type)
  and this same `packages/types` comment.
- **No background-job/cron infrastructure exists** in this codebase — no
  scheduled-task runner, no queue. A time-based "send a reminder N hours
  before" trigger has nowhere to run from today.
- **No "on the way" job-status action exists.** `JobOutcome.status`
  (`repositories/jobOutcomes.ts`) only models `"in_progress"` and
  `"completed"`, recorded after the fact via the dashboard's "Record actual
  job" panel — there is no intermediate "mark myself en route" business
  action anywhere.
- The one real, wired status transition in the whole quote/job lifecycle
  that fires **automatically** from an existing, already-shipped UI action
  is `JobOutcome.status` transitioning into `"completed"` — the natural,
  and only, home for the post-service thank-you trigger.
- The one place a **new, never-before-seen** `Customer` row is created for
  the public estimator is `createCustomerForBusiness`, called exactly once
  per `createQuotePublic` call — confirmed by re-reading ADR 0029's own
  audit, which already established this creates a fresh row every time,
  never matching an existing one. That makes "this request just granted
  consent for the first time" true by construction at that single call
  site, with no history table needed to detect "newly granted."

## What was built

**`services/api/src/services/customerSms.ts`** — six sender functions
(`sendOptInConfirmationSms`, `sendEstimateReadySms`,
`sendAppointmentConfirmationSms`, `sendAppointmentReminderSms`,
`sendOnTheWaySms`, `sendPostServiceThankYouSms`), all funneling through one
private `dispatch()` gate: `isCustomerSmsEligible` → `normalizePhoneNumber`
(reused from `business.ts`, not reimplemented) → a 30-second
per-`kind:phone` cooldown (same throttle pattern as `quoteSmsAlert.ts`'s
`isThrottled`, scoped per message kind so a legitimate opt-in +
estimate-ready pair sent together for one real submission never suppresses
each other) → `sendSms`. Every body starts with `"Tallyvis:"`, ends with
the STOP/HELP line, and contains no link, no phone number, and no
promotional copy, per the V1 content rules.

**Wired (fires automatically today):**

| Message | Trigger | Where |
|---|---|---|
| Opt-in confirmation | A genuinely new, consenting `Customer` row is created | `createQuotePublic` |
| Estimate ready | `Quote.status` transitions into `"approved"` (not already `"approved"`) — see "2026-10 correction" below | `updateQuoteStatus` |
| Post-service thank-you | `JobOutcome.status` transitions into `"completed"` (not already `"completed"`) | `recordJobOutcome` |

`createQuotePublic`, `updateQuoteStatus`, and `recordJobOutcome` each take
an optional `onSmsNotified` callback and hand every fire-and-forget SMS's
`finished` promise back to the caller so `apps/app` can register it with
Next's `after()` — `createPublicQuoteAction`/`recordJobOutcomeAction`
already did this; `updateQuoteStatusAction` now does too.

### 2026-10 correction — estimate-ready SMS trigger

**This ADR originally wired `sendEstimateReadySms` to `createQuotePublic`,
firing the moment a customer submitted a quote request — before any
business review.** This did not match the intended V1 behavior (the
customer should be told their estimate is ready only once the business
has actually approved it) and was found and fixed during a pre-A2P-
submission compliance audit. The fix moved the send into
`updateQuoteStatus`'s transition into `"approved"` (`QuoteStatus`'s own
existing approval state — see `@tallyvis/types`' `QUOTE_STATUS_TRANSITIONS`
— not a new parallel concept), guarded by the same "only on the actual
transition, never on a no-op re-run" pattern `recordJobOutcome`'s
`justCompleted` already established, so re-approving (which
`canTransitionQuoteStatus` already refuses) or any later transition
(`approved` → `sent`) can never re-send it. See
docs/decisions/0032-sms-stop-start-sync.md for the full audit this
correction was part of, and `services/api/src/services/quotes.ts`'s
`updateQuoteStatus` for the current implementation.

**Implemented, not wired (no trigger exists to call them from):**
`sendAppointmentConfirmationSms`, `sendAppointmentReminderSms`,
`sendOnTheWaySms` — all exported from `services/api`'s `index.ts` so
whichever future feature adds scheduling, a reminder cron, or an "on the
way" action doesn't have to rebuild a consent-gated sender from scratch.

## What was deliberately not built

No scheduling/appointment data model, no cron/background-job runner, no
"mark as on the way" dashboard action — all out of scope; inventing any of
them would have been unrequested product behavior, not infrastructure this
task asked for. No change to `sendNewQuoteSmsAlert` or the business-owner
alert's own behavior. Application-side STOP/HELP state sync was flagged
here as the next real gap and has since been built — see
docs/decisions/0032-sms-stop-start-sync.md.

## Verification

Originally, this phase's own test suite could not be executed in that
environment (no Postgres connection available) and was only
architecture-verified. It has since been executed, as part of the 2026-10
correction above, against a real Postgres test database — see
docs/decisions/0032-sms-stop-start-sync.md's own Verification section for
the current, actually-passing counts covering both this phase's tests and
0032's.
