import type { Queryable } from "../db/pg/client";
import { verifyTwilioWebhookSignature } from "../notifications/sms/verifyWebhookSignature";
import { normalizePhoneNumber } from "./business";
import * as customersRepo from "../repositories/customers";

/**
 * V1 STOP/START synchronization (see
 * docs/decisions/0032-sms-stop-start-sync.md). ADR 0029/0031 deliberately
 * relied entirely on Twilio's own carrier-level STOP/HELP handling and
 * built no inbound webhook — this closes exactly that gap, and only that
 * gap: keeping `customers.sms_consent` in sync with a STOP/START reply,
 * nothing more.
 */
export class TwilioWebhookVerificationError extends Error {}

/**
 * Twilio's own documented default Messaging Service keywords
 * (https://www.twilio.com/docs/messaging/features/opt-out) — matched
 * case-insensitively against the ENTIRE trimmed message body, never a
 * substring match, so an unrelated message that happens to contain the
 * word "stop" is never misread as an opt-out. Deliberately not configurable
 * here: these are Twilio's own defaults, and a Messaging Service's Advanced
 * Opt-Out settings in Twilio Console (not this file) are the real source of
 * truth for which keywords Twilio itself honors — see this module's own
 * "What Kyle must verify in Twilio Console" note in the ADR.
 */
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

export type SmsOptEventResult = "opted-out" | "reopted-in" | "ignored";

/**
 * Verifies the signature (throwing `TwilioWebhookVerificationError` if it
 * doesn't check out — the caller must respond with a non-2xx status, never
 * process an unverified payload) and, for a recognized STOP or START/
 * re-opt-in keyword only, synchronizes `customers.sms_consent` for every
 * customer row (across every business — see `listCustomersWithPhone`'s own
 * comment) whose stored phone number normalizes to the same number Twilio
 * says texted in. Any other inbound message (HELP, or anything
 * unrecognized) is intentionally a no-op: this function must never treat
 * an arbitrary inbound text as consent of any kind.
 *
 * `rawBody` is the exact `application/x-www-form-urlencoded` body Twilio
 * POSTed — parsed here (not by the caller) because the same parsed
 * key/value pairs are needed both for signature verification and for
 * reading `From`/`Body`.
 */
export async function handleTwilioSmsWebhook(
  db: Queryable,
  rawBody: string,
  signatureHeader: string | null,
  requestUrl: string,
  authToken: string,
): Promise<SmsOptEventResult> {
  const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

  if (!signatureHeader || !verifyTwilioWebhookSignature(requestUrl, params, signatureHeader, authToken)) {
    throw new TwilioWebhookVerificationError("Twilio webhook signature verification failed.");
  }

  const from = params.From;
  const body = (params.Body ?? "").trim().toUpperCase();
  if (!from) return "ignored";

  const normalizedFrom = normalizePhoneNumber(from);
  if (!normalizedFrom) return "ignored";

  const isStop = STOP_KEYWORDS.has(body);
  const isStart = START_KEYWORDS.has(body);
  if (!isStop && !isStart) return "ignored"; // includes HELP — Twilio Console owns that auto-reply, not this app

  const candidates = await customersRepo.listCustomersWithPhone(db);
  const matches = candidates.filter((customer) => normalizePhoneNumber(customer.phone!) === normalizedFrom);
  if (matches.length === 0) return "ignored";

  const occurredAt = new Date().toISOString();

  if (isStop) {
    await Promise.all(matches.map((customer) => customersRepo.recordSmsOptOut(db, customer.id, occurredAt)));
    return "opted-out";
  }

  // START only ever REACTIVATES a customer who had previously opted out —
  // it must never manufacture consent for a row that was never granted in
  // the first place (e.g. a wrong number, or someone who never checked the
  // web opt-in box at all). See `Customer.smsReoptedInAt`'s own comment.
  const reactivatable = matches.filter((customer) => customer.smsOptedOutAt !== undefined);
  if (reactivatable.length === 0) return "ignored";
  await Promise.all(reactivatable.map((customer) => customersRepo.recordSmsReOptIn(db, customer.id, occurredAt)));
  return "reopted-in";
}
