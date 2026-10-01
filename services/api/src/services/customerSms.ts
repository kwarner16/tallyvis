import type { Customer } from "@tallyvis/types";
import { sendSms } from "../notifications/sms";
import { normalizePhoneNumber } from "./business";
import { isCustomerSmsEligible } from "./customers";

/**
 * Phase 15 continuation — the V1 customer-facing SMS messaging program (see
 * docs/decisions/0029-sms-consent-and-a2p-10dlc.md for the consent
 * foundation this builds on). Every message here texts the CUSTOMER's own
 * phone — unlike `quoteSmsAlert.ts`'s `sendNewQuoteSmsAlert`, which only
 * ever texts the BUSINESS owner. All six message kinds funnel through the
 * same `dispatch` gate below, so "only send when eligible" and "never throw
 * into the caller" are true by construction rather than re-implemented six
 * times.
 *
 * Every message body starts with "Tallyvis:" (brand identification), ends
 * with "Reply STOP to opt out or HELP for assistance" (V1 relies entirely
 * on Twilio's own carrier-level STOP/HELP handling — see
 * `notifications/sms/providers/twilio.ts`'s own comment; there is no
 * inbound webhook in this codebase, so a STOP reply does NOT update
 * `customers.sms_consent` here — Twilio suppresses future sends at the
 * carrier/provider level regardless of what this database still shows),
 * and deliberately contains no link, no phone number, and no promotional
 * copy, per the V1 content rules.
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
 * only ever sees the customer record, not its history.
 */
export function sendOptInConfirmationSms(customer: Customer): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-opt-in-confirmation",
    "Tallyvis: You're signed up for service-related text updates. Message frequency varies based on quote, appointment, and service activity. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  );
}

/** 2. Estimate ready. Deliberately no link (V1 content rule) — just a status notification. Wired to `createQuotePublic` only; never resent on re-analysis (`updateQuotePublic`). */
export function sendEstimateReadySms(customer: Customer): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-estimate-ready",
    "Tallyvis: Your service estimate is ready. Reply STOP to opt out or HELP for assistance.",
  );
}

export interface AppointmentSmsDetails {
  /** Pre-formatted for display, e.g. "Oct 14" — this module does no date formatting of its own. */
  date: string;
  /** Pre-formatted for display, e.g. "2:00 PM". */
  time: string;
}

/**
 * 3. Appointment confirmation. NOT WIRED to any trigger — Tallyvis has no
 * appointment/scheduling data model yet (no scheduled date/time field
 * anywhere in `packages/types`, no "schedule an appointment" UI). Exists so
 * that feature, whenever it's built, has a ready-to-call, already-gated
 * sender instead of reinventing consent/eligibility checks. See the final
 * report in the PR/commit this shipped with for what's still required.
 */
export function sendAppointmentConfirmationSms(
  customer: Customer,
  appointment: AppointmentSmsDetails,
): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-appointment-confirmation",
    `Tallyvis: Your service appointment is confirmed for ${appointment.date} at ${appointment.time}. Reply STOP to opt out or HELP for assistance.`,
  );
}

/**
 * 4. Appointment reminder. NOT WIRED — same missing scheduling model as
 * above, plus no background-job/cron infrastructure exists in this
 * codebase to fire this automatically before a future appointment even if
 * one were scheduled.
 */
export function sendAppointmentReminderSms(
  customer: Customer,
  appointment: AppointmentSmsDetails,
): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-appointment-reminder",
    `Tallyvis: Reminder that your service appointment is scheduled for ${appointment.date} at ${appointment.time}. Reply STOP to opt out or HELP for assistance.`,
  );
}

/**
 * 5. Estimated arrival / on-the-way. NOT WIRED — `JobOutcome.status` (see
 * `repositories/jobOutcomes.ts`) only models `"in_progress"` and
 * `"completed"`, recorded after the fact on the "Record actual job" panel;
 * there is no "mark myself on the way" business action anywhere in the
 * dashboard to call this from.
 */
export function sendOnTheWaySms(customer: Customer, etaMinutes: number): { finished: Promise<void> } | null {
  return dispatch(
    customer,
    "customer-on-the-way",
    `Tallyvis: Your service provider is on the way and expects to arrive in approximately ${etaMinutes} minutes. Reply STOP to opt out or HELP for assistance.`,
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
    "Tallyvis: Thank you for choosing Tallyvis. We appreciate your business. Reply STOP to opt out or HELP for assistance.",
  );
}
