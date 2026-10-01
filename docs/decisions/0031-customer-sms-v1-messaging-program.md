# 0030 — V1 customer-facing SMS messaging program

**Status:** Accepted

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
| Estimate ready | Same call, immediately after the quote is persisted | `createQuotePublic` |
| Post-service thank-you | `JobOutcome.status` transitions into `"completed"` (not already `"completed"`) | `recordJobOutcome` |

Both `createQuotePublic` (via its existing `onSmsNotified` callback,
already used by the business-owner alert) and `recordJobOutcome` (a new,
identically-shaped optional `onSmsNotified` parameter) hand every
fire-and-forget SMS's `finished` promise back to the caller so `apps/app`
can register it with Next's `after()` — `createPublicQuoteAction` already
did this; `recordJobOutcomeAction` now does too.

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
alert's own behavior. No application-side STOP/HELP state sync — V1 still
relies entirely on Twilio's own carrier-level handling (ADR 0029's
limitation stands unchanged): a STOP reply does **not** update
`customers.sms_consent` in this database, so a business's dashboard view of
a customer's consent can go stale relative to what Twilio is actually
honoring. Kyle should treat a real inbound Twilio webhook (updating
`sms_consent` on a STOP, confirming on a START/subsequent opt-in) as the
next real gap before fully relying on this database as the source of truth
for who can be texted.

## Verification

`pnpm --filter @tallyvis/api typecheck`, `pnpm --filter @tallyvis/api
lint`, `pnpm --filter @tallyvis/app lint`, and `pnpm --filter @tallyvis/app
build` all pass. 17 new tests in
`services/api/src/__tests__/customerSms.test.ts` were written following
the existing `quoteSmsAlert.test.ts`/`smsConsent.test.ts` conventions
(spying on `sendSms`, never a real Twilio call) and are believed correct,
but **could not be executed in this environment** — `services/api`'s test
suite requires a real Postgres connection (`DATABASE_URL`/`DIRECT_URL` in
`services/api/.env.local`, per `docs/decisions/0021-postgres-migration.md`),
and no Postgres instance, Docker, or credentials were available here (the
same "architecture-verified, not live-verified" caveat ADR 0029 already
applies to the live Twilio send itself now additionally applies to this
phase's own test suite execution). Kyle must run `pnpm --filter
@tallyvis/api test` with real credentials before trusting this as
confirmed-passing, and should treat that as a blocker before relying on
this phase for the A2P submission.
