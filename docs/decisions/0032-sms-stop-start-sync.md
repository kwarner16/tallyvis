# 0032 — Pre-A2P-submission SMS audit: trigger fix, consent UX, STOP/START sync

**Status:** Accepted

## Context

Before submitting TallyVis's A2P 10DLC campaign and launching production
SMS, a focused audit of the existing V1 customer SMS system (ADR
0028/0029/0031) was requested — not a redesign, not new message types,
just: verify the implementation actually matches what will be described in
the campaign submission, and fix what doesn't.

## What was audited, and what was found

- **The estimate-ready SMS fired at the wrong time.** `createQuotePublic`
  sent it immediately on quote submission, before any business review —
  see ADR 0031's "2026-10 correction." The intended behavior (confirmed
  against the actual product flow) is: email always goes out when the
  business approves; SMS additionally goes out, to SMS-eligible customers
  only, at that same moment. There was no code path that fired it on
  approval at all.
- **The opt-in confirmation trigger was already correct.**
  `createCustomerForBusiness` always creates a brand-new `Customer` row
  for every public-estimator submission (never matches an existing one —
  see ADR 0029's own audit), so "this request just granted consent" is
  true by construction at that one call site; there is no "already
  consented, resubmitting" case to accidentally re-fire on, and
  `updateQuotePublic` (re-analysis) never touches the customer row at all.
  No change was needed here.
- **The post-service thank-you trigger was already correct** —
  `recordJobOutcome`'s `justCompleted` guard already fires exactly once,
  on the real transition into `"completed"`.
- **The estimator's SMS checkbox could be checked with no phone number
  entered at all.** Submitting that way already correctly recorded no
  consent server-side (`createCustomerForBusiness`'s `hasPhone` check), but
  the UI let a customer "consent" to something that silently did nothing —
  confusing, and not disclosure-consistent.
- **The consent disclosure text was broader than the active program** — it
  named appointment confirmations/reminders and estimated-arrival
  notifications, none of which are wired to any trigger (see ADR 0031).
  Twilio campaign review compares the opt-in disclosure against the actual
  sample messages submitted; a mismatch here is exactly the kind of thing
  that gets a campaign rejected or suspended.
- **No inbound Twilio webhook existed** — ADR 0029/0031 both explicitly
  flagged this as relying entirely on Twilio's own carrier-level STOP/HELP
  handling, with `customers.sms_consent` going stale relative to reality
  the moment a real customer replied STOP. Confirmed: still true, still
  the single largest gap before this database can be trusted as the source
  of truth for who can be texted.
- **The legal pages (`/privacy`, `/terms`) never stated who operates
  TallyVis**, and listed appointment/arrival/review-request messages as
  live program content (copied from the same over-broad language as the
  disclosure above).
- **No public opt-in proof page existed**, and no real screenshots of the
  estimator form exist in this environment to put on one.
- **Twilio env vars**: confirmed via `services/api/src/notifications/sms/index.ts`
  (the one place they're read) — `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` are required for `SMS_PROVIDER=twilio`; exactly one
  of `TWILIO_MESSAGING_SERVICE_SID`/`TWILIO_FROM_NUMBER` is required (not
  both — the Messaging Service is preferred when both are set, per that
  file's own comment), and misconfiguration throws a categorized
  `NotificationError("not-configured")` rather than silently failing —
  confirmed by reading `resolveSmsProvider`, not assumed. All of
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_MESSAGING_SERVICE_SID`/
  `TWILIO_FROM_NUMBER`/`SMS_PROVIDER` were already declared in
  `turbo.json`'s `tasks.build.env` (see docs/decisions/0030) — no turbo
  change was needed for the new webhook, since it reads `TWILIO_AUTH_TOKEN`
  at REQUEST time inside a Route Handler, not at build time.
- **Whether the Twilio phone number/Messaging Service is already
  associated with an approved A2P campaign is NOT verifiable from this
  repository** — no Twilio API credentials or Console access were used
  here; this remains a manual check (see "Manual Twilio Console actions"
  below).

## What was built

**Trigger fix (see ADR 0031's own "2026-10 correction"):** the
estimate-ready SMS now fires from `updateQuoteStatus`'s transition into
`"approved"`, not `createQuotePublic`.

**Consent UX — phone-gated checkbox:** `apps/app/src/app/estimate/review/page.tsx`'s
SMS checkbox is now `disabled` until the phone field holds a plausible
number (`isPlausiblePhoneNumber`, a client-side mirror of
`services/business.ts`'s `normalizePhoneNumber` shape check — duplicated,
not shared, because a "use client" page can never import `services/api`,
which pulls in `node:sqlite`). Editing the phone field down to something
invalid also clears any consent already given. The server-side gate
(`createCustomerForBusiness`) was already correct and is unchanged; this
is a UX fix, not a security fix — the checkbox could never have produced
real consent without a real phone, it could only look like it did.

**Consent disclosure text** (`SMS_CONSENT_DISCLOSURE_TEXT`,
`@tallyvis/types`, version bumped to `2026-10-01.v2`): rewritten to name
TallyVis explicitly and describe only the three active V1 message types
(opt-in confirmation, approved-estimate updates, post-service follow-ups),
with no mention of appointments or arrival. The opt-in confirmation SMS
body (`sendOptInConfirmationSms`) was updated to match. The estimate-ready
SMS body now explicitly says "approved" and directs the customer to check
their email, per the actual product flow (email always sent on approval;
SMS is the additional, eligible-only channel). Brand prefix standardized
to `"TallyVis:"` across all six sender functions (cosmetic — see
`CLAUDE.md`'s "Brand capitalization does not need a special migration").

**STOP/START synchronization** (closing the gap ADR 0029/0031 both
flagged):

- Migration `0010_sms_stop_start_sync.sql` adds `customers.sms_opted_out_at`
  and `customers.sms_reopted_in_at`. Neither is ever cleared by the other,
  and neither touches the original `sms_consent_at`/`sms_consent_source`/
  `sms_consent_disclosure_version` columns from migration 0009 — a STOP
  never erases the historical record that real consent was once given,
  which audit purposes require.
- `services/api/src/notifications/sms/verifyWebhookSignature.ts` —
  `verifyTwilioWebhookSignature`, a pure, dependency-free implementation of
  Twilio's own documented `X-Twilio-Signature` algorithm (URL + sorted
  POST params, HMAC-SHA1 with the Auth Token, base64), mirroring this
  repo's existing `verifyStripeWebhookSignature` exactly. Verified here
  against hand-computed signatures in `smsWebhooks.test.ts`, matching the
  same "architecture-verified, not live-verified" caveat ADR 0029 already
  applies to the Twilio send path — no real Twilio-signed request has
  reached this code in this environment.
- `services/api/src/services/smsWebhooks.ts` — `handleTwilioSmsWebhook`
  verifies the signature (throwing `TwilioWebhookVerificationError` on
  failure — the caller must respond non-2xx) and, ONLY for a message body
  that exactly matches one of Twilio's own documented default keywords
  (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT for opt-out,
  START/YES/UNSTOP for opt-in — https://www.twilio.com/docs/messaging/features/opt-out),
  updates every `customers` row across every business whose stored phone
  number normalizes to the same number Twilio reports in `From`. HELP and
  any other inbound text are no-ops — never treated as consent of any
  kind, per the task's explicit requirement.
- **Why the match is global, not scoped to one business:** TallyVis sends
  all customer-facing SMS through ONE shared `TWILIO_MESSAGING_SERVICE_SID`/
  `TWILIO_FROM_NUMBER` (read as plain, non-per-business env vars in
  `notifications/sms/index.ts`) — not a Twilio number per business. The
  same physical phone number can legitimately have `customers` rows under
  several different businesses (a fresh row is created per public
  submission — ADR 0029), and Twilio's own carrier-level suppression after
  a STOP applies to the number globally regardless of which business's
  quote a given row came from. A new `listCustomersWithPhone` repository
  function (deliberately the only query in `repositories/customers.ts` not
  scoped by `businessId` — see its own comment) finds every candidate row;
  matching itself still happens via `normalizePhoneNumber`, since
  `customers.phone` is stored as the customer's raw typed input (e.g.
  `"555-000-1111"`), not pre-normalized, and changing that storage format
  was out of scope here.
- **START only ever reactivates a customer who had previously opted out**
  (`sms_opted_out_at` already set) — it never manufactures consent for a
  row that was never granted in the first place (a wrong number, or a
  customer who never checked the web opt-in box). This is the "do not
  treat arbitrary inbound messages as consent" requirement made concrete.
- `apps/app/src/app/api/webhooks/twilio-sms/route.ts` — a Route Handler
  (not a Server Action, for the same raw-body/signature reason
  `/api/webhooks/stripe` already is one), reading the raw body and
  `X-Twilio-Signature` header, returning 501 if `TWILIO_AUTH_TOKEN` isn't
  configured, 400 on a bad signature, 500 on an unexpected error, 200
  otherwise. Deliberately returns no TwiML `<Message>` — Twilio's own
  Advanced Opt-Out/default keyword handling already sends the real
  STOP/START/HELP auto-reply at the carrier level; this app must never
  send a second, duplicate one.

**Legal pages** (`/privacy`, `/terms`): both now state plainly that
TallyVis is a product/brand operated directly by Kyle Warner and is not
currently a separate, formally registered company (never calling it a
DBA, per the task's explicit instruction). Both pages' SMS sections were
trimmed to list only the three active V1 message types, with a sentence
noting that TallyVis does not currently send appointment/arrival/review-
request/promotional messages and that future additions will come with an
updated disclosure. `/terms`' SMS section now also names
`kyle@tallyvis.com` as the SMS program's own support contact, alongside
the existing Section 24 contact reference.

**Public opt-in proof page** (`apps/web/src/app/sms-opt-in-proof/page.tsx`,
reachable with no login at `/sms-opt-in-proof`): renders the live
`SMS_CONSENT_DISCLOSURE_TEXT`/`SMS_CONSENT_DISCLOSURE_VERSION` constants
directly from `@tallyvis/types` (never a copy-pasted string, so it cannot
drift from what the real checkbox shows) and two `<img>` slots pointing at
`apps/web/public/sms-opt-in-proof/estimator-form.png` and
`.../post-submission.png`. **Neither image file exists yet** — no
fabricated/mocked screenshot was created. The page says so explicitly
("Screenshot pending — not yet captured") next to each slot. See the
engineering report this ADR shipped with for exactly what Kyle must
capture and add before this page is ready to submit as Twilio opt-in
proof. Built in `apps/web` (the marketing site), not `apps/app`, since
it's a static compliance artifact in the same family as `/privacy`/`/terms`,
not part of the estimator wizard itself; added to `apps/web/src/app/sitemap.ts`
per that file's own "add a new route in the same commit" convention.

## What was deliberately not built

No marketing/promotional SMS, no new message types beyond the three V1
ones, no changes to `sendAppointmentConfirmationSms`/
`sendAppointmentReminderSms`/`sendOnTheWaySms` beyond a cosmetic brand-
prefix fix and strengthened "FUTURE / NOT ACTIVE" comments — all three
remain unwired, exactly as ADR 0031 left them. No change to
`sendNewQuoteSmsAlert` (the business-owner alert) or its trigger. No
distributed/cross-instance locking added to the STOP/START handler or to
`updateQuoteStatus`'s new SMS guard — both rely on the same
read-then-write pattern (and, for `updateQuoteStatus`, the existing
`canTransitionQuoteStatus` transition-graph check) every other mutation in
this codebase already uses; a genuine concurrent double-click race was
judged out of scope for this pass, consistent with the codebase's existing
risk tolerance (see `recordJobOutcome`'s identical pattern). No change to
`customers.phone`'s storage format (still the customer's raw typed input,
not pre-normalized) — `listCustomersWithPhone` doing an unscoped full-table
read and normalizing in application code is a known V1 scaling
limitation, not a correctness gap, flagged here rather than silently
accepted: revisit (e.g. a normalized-phone column + index) if customer
volume grows enough for this to matter.

## HELP auto-reply wording

Twilio Console / Messaging Service settings own the actual HELP auto-reply
text, and nothing in this repository can read or verify what that
currently says. **Not fabricated here.** Kyle must configure it to
reference `kyle@tallyvis.com` directly in Twilio Console (see "Manual
Twilio Console actions" below) — this repo's own SMS bodies already say
"Reply HELP for help/assistance," which is as far as application code can
go; the actual HELP response is Twilio's to send.

## Manual Twilio Console actions required (cannot be done from this repo)

1. **Configure the inbound webhook URL** for the Messaging Service (or
   phone number) to `https://app.tallyvis.com/api/webhooks/twilio-sms`.
2. **Check Advanced Opt-Out routing.** Twilio's default Messaging Service
   behavior can fully intercept and auto-reply to STOP/START/HELP keywords
   at the carrier level WITHOUT ever forwarding the inbound message to a
   configured webhook. If that default "filter silently" behavior is
   active, `handleTwilioSmsWebhook` above will never actually receive a
   STOP/START event, and `customers.sms_consent` will stay exactly as
   stale as it was before this ADR. Kyle must confirm, in Twilio Console,
   that inbound STOP/START messages are actually forwarded to the webhook
   above (not just silently filtered) — this is a real ambiguity in
   Twilio's product, not something this repository can resolve or assume
   either way.
3. **Set the HELP auto-reply text** to reference `kyle@tallyvis.com`.
4. **Confirm the Twilio phone number/Messaging Service is actually
   associated with an approved/submitted A2P 10DLC campaign** — not
   assumed true by this ADR or any prior one; see the task's own explicit
   instruction not to assume this.
5. **Verify the signature algorithm against a real request** once steps
   1–2 are done — send a real STOP from a test phone and confirm the
   webhook returns 200 and the customer's `sms_consent` actually flips in
   the database, since `verifyTwilioWebhookSignature` has only been tested
   against hand-computed signatures here, never a live Twilio request.

## Verification

`pnpm --filter @tallyvis/api typecheck`, `pnpm --filter @tallyvis/api
lint`, `pnpm --filter @tallyvis/app typecheck`, `pnpm --filter
@tallyvis/app lint`, `pnpm --filter @tallyvis/web lint`, `pnpm --filter
@tallyvis/app build`, and `pnpm --filter @tallyvis/web build` all pass.
`pnpm --filter @tallyvis/api test` — unlike ADR 0031's own test suite,
which could not be run in that environment — was actually executed here
against a real Postgres test database: **417 of 417 tests pass**,
including the rewritten `customerSms.test.ts` (approval-triggered
estimate-ready SMS, no-send-on-submission, no-double-send-on-re-approval)
and the new `smsWebhooks.test.ts` (signature verification, STOP, duplicate
STOP, global cross-business matching, START-only-after-opt-out, duplicate
START, a bare START never manufacturing consent, invalid/missing
signature rejection, HELP and unrelated text as no-ops). `apps/app` has no
test suite of its own (per `CLAUDE.md`) — the phone-gated checkbox is a
client-side UX guard only; the authoritative, tested gate remains
`createCustomerForBusiness`'s server-side check, unchanged by this ADR.
