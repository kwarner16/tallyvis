import type { Customer } from "@tallyvis/types";
import { sendSms } from "../notifications/sms";
import { normalizePhoneNumber } from "./business";
import { isCustomerSmsEligible } from "./customers";

/**
 * Phase 15 continuation — the V1 customer-facing SMS messaging program (see
 * docs/decisions/0029-sms-consent-and-a2p-10dlc.md for the consent
 * foundation this builds on, 0031 for the messaging program itself, and
 * 0032 for STOP/START sync). Every message here texts the CUSTOMER's own
 * phone — unlike `quoteSmsAlert.ts`'s `sendNewQuoteSmsAlert`, which only
 * ever texts the BUSINESS owner. All six message kinds funnel through the
 * same `dispatch` gate below, so "only send when eligible" and "never throw
 * into the caller" are true by construction rather than re-implemented six
 * times.
 *
 * ONLY THREE of the six senders below are part of the active V1 campaign:
 * `sendOptInConfirmationSms`, `sendEstimateReadySms`, and
 * `sendPostServiceThankYouSms` — see `services/api/src/index.ts`'s own
 * comment for exactly what each is wired to. The other three
 * (appointment confirmation/reminder, "on the way") are implemented but
 * have no trigger anywhere in this codebase and must never be described as
 * active customer behavior (e.g. in the A2P campaign description, the
 * consent disclosure, or the legal pages) until something actually calls
 * them.
 *
 * Every message body starts with "TallyVis:" (brand identification), ends
 * with "Reply STOP to opt out or HELP for assistance" (`isCustomerSmsEligible`
 * gates every send on current `smsConsent`, which `smsWebhooks.ts`'s
 * inbound webhook now keeps in sync with a real STOP/START reply — see
 * docs/decisions/0032-sms-stop-start-sync.md; Twilio's own carrier-level
 * suppression after a STOP is still the first line of defense regardless
 * of this database's state), and deliberately contains no link, no phone
 * number, and no promotional copy, per the V1 content rules.
 */

/**
 * Same best-effort, single-process throttle as `quoteSmsAlert.ts`'s
 * `isThrottled` — not a distributed rate limiter, just enough to stop an
 * accidental double-submit (a network retry, a double-click) from texting
 * the same customer twice in quick succession. Keyed by `kind:phone` rather
 * than phone alone, so a legitimate opt-in-confirmation-plus-estimate-ready
 * pair sent together for one genuine submission is never suppressed by each
 * other.
 */
const COOLDOWN_MS = 30_000;
const lastSentAt = new Map<string, number>();

function isThrottled(key: string): boolean {
  const last = lastSentAt.get(key);
  return last !== undefined && Date.now() - last < COOLDOWN_MS;
}

/**
 * The one gate every customer-facing SMS passes through: eligibility
 * (`isCustomerSmsEligible` — consent AND a phone present), a parseable
 * phone number (same `normalizePhoneNumber` the business alert already
 * uses — never sends to something that can't possibly be a real number),
 * and the per-kind cooldown above. Returns `null` (not a rejected promise)
 * when nothing was sent, so callers can tell "declined to send" apart from
 * "sent, but the provider failed" without a try/catch.
 */
function dispatch(
  customer: Pick<Customer, "phone" | "smsConsent">,
  kind: string,
  body: string,
): { finished: Promise<void> } | null {
  if (!isCustomerSmsEligible(customer)) return null;
  const to = normalizePhoneNumber(customer.phone!);
  if (!to) return null;

  const key = `${kind}:${to}`;
  if (isThrottled(key)) return null;
  lastSentAt.set(key, Date.now());

  const finished = sendSms({ to, body }, kind).then(
    () => {},
    (err: unknown) => {
      console.error(`customerSms (${kind}): background SMS send failed:`, err);
    },
  );
  return { finished };
}

/**
 * 1. Opt-in confirmation. Required by Twilio A2P 10DLC registration.
 * Callers must only invoke this at the exact moment consent is newly
 * granted (see `createQuotePublic`'s own comment) — this function has no
 * way to tell "newly granted" from "already consented" itself, since it
 * only ever sees the customer record, not its history. Content mirrors
 * `SMS_CONSENT_DISCLOSURE_TEXT` (`@tallyvis/types`) — V1 program only, no
 * mention of appointments/arrival, since neither is active (see this
 * file's own top comment).
 */
export function sendOptInConfirmationSms(customer: Customer): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-opt-in-confirmation",
    "TallyVis: You're signed up for service-related SMS updates (opt-in confirmation, approved estimate updates, and post-service follow-ups). Message frequency varies based on quote and service activity. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  );
}

/**
 * 2. Approved estimate notification. Deliberately no link and no phone
 * number (V1 content rule) — directs the customer back to their email,
 * where the actual estimate (sent separately, by email, when the business
 * approves) lives. Wired to `updateQuoteStatus`'s transition into
 * `"approved"` — see that function's own comment for why creation/
 * resubmission (`createQuotePublic`/`updateQuotePublic`) never fires this.
 */
export function sendEstimateReadySms(customer: Customer): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-estimate-ready",
    "TallyVis: Your estimate has been approved and is ready. Check your email for the details. Reply STOP to opt out or HELP for assistance.",
  );
}

export interface AppointmentSmsDetails {
  /** Pre-formatted for display, e.g. "Oct 14" — this module does no date formatting of its own. */
  date: string;
  /** Pre-formatted for display, e.g. "2:00 PM". */
  time: string;
}

/**
 * 3. Appointment confirmation. FUTURE / NOT ACTIVE — not part of the V1
 * A2P campaign, and not wired to any trigger: TallyVis has no appointment/
 * scheduling data model yet (no scheduled date/time field anywhere in
 * `packages/types`, no "schedule an appointment" UI). Exists so that
 * feature, whenever it's built, has a ready-to-call, already-gated sender
 * instead of reinventing consent/eligibility checks — do not describe this
 * as active customer behavior (campaign descriptions, consent disclosure,
 * legal pages) until something actually calls it.
 */
export function sendAppointmentConfirmationSms(
  customer: Customer,
  appointment: AppointmentSmsDetails,
): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-appointment-confirmation",
    `TallyVis: Your service appointment is confirmed for ${appointment.date} at ${appointment.time}. Reply STOP to opt out or HELP for assistance.`,
  );
}

/**
 * 4. Appointment reminder. FUTURE / NOT ACTIVE — same missing scheduling
 * model as above, plus no background-job/cron infrastructure exists in
 * this codebase to fire this automatically before a future appointment
 * even if one were scheduled. Not part of the V1 A2P campaign.
 */
export function sendAppointmentReminderSms(
  customer: Customer,
  appointment: AppointmentSmsDetails,
): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-appointment-reminder",
    `TallyVis: Reminder that your service appointment is scheduled for ${appointment.date} at ${appointment.time}. Reply STOP to opt out or HELP for assistance.`,
  );
}

/**
 * 5. Estimated arrival / on-the-way. FUTURE / NOT ACTIVE — `JobOutcome.status`
 * (see `repositories/jobOutcomes.ts`) only models `"in_progress"` and
 * `"completed"`, recorded after the fact on the "Record actual job" panel;
 * there is no "mark myself on the way" business action anywhere in the
 * dashboard to call this from. Not part of the V1 A2P campaign.
 */
export function sendOnTheWaySms(customer: Customer, etaMinutes: number): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-on-the-way",
    `TallyVis: Your service provider is on the way and expects to arrive in approximately ${etaMinutes} minutes. Reply STOP to opt out or HELP for assistance.`,
  );
}

/**
 * 6. Post-service thank-you. Wired to `recordJobOutcome` (see
 * `services/jobOutcomes.ts`) — the one place a job's `status` actually
 * transitions to `"completed"` today, via the dashboard's existing "Record
 * actual job" panel. No review link or marketing copy (V1 content rule).
 */
export function sendPostServiceThankYouSms(customer: Customer): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-post-service-thank-you",
    "TallyVis: Thank you for choosing our service. We appreciate your business. Reply STOP to opt out or HELP for assistance.",
  );
}
