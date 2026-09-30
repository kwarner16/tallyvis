import type { Customer, CustomerInput } from "@tallyvis/types";
import { SMS_CONSENT_SOURCE_PUBLIC_ESTIMATOR, SMS_CONSENT_DISCLOSURE_VERSION } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import * as customersRepo from "../repositories/customers";

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/**
 * The UI already keeps a customer from being submitted without a name and
 * valid email (see `CustomerEditor`/`NewQuoteClient`), but a Server Action
 * can be called directly, bypassing any client-side check — this is the
 * check that's actually authoritative.
 */
function validateCustomerInput(input: CustomerInput): void {
  if (input.name.trim().length === 0) {
    throw new Error("Customer name is required.");
  }
  if (!EMAIL_PATTERN.test(input.email)) {
    throw new Error("A valid customer email is required.");
  }
}

export async function listCustomers(db: Queryable, session: AuthSession): Promise<Customer[]> {
  return customersRepo.listCustomers(db, session.businessId);
}

export async function getCustomer(db: Queryable, session: AuthSession, id: string): Promise<Customer | undefined> {
  return customersRepo.getCustomerById(db, session.businessId, id);
}

/**
 * Reuses an existing customer (matched by email, case-insensitively) for
 * this business rather than forking a new record every time the same
 * person is quoted again. Note this is the AUTHENTICATED business's own
 * "create/reuse a customer" path (the dashboard's "New quote" flow) — it
 * deliberately never forwards `input.smsConsent`, even if somehow set, to
 * the repository: a business entering a customer's details on that
 * customer's behalf is not the customer affirmatively consenting to SMS
 * themselves (see `CustomerInput.smsConsent`'s own comment). Only
 * `createCustomerForBusiness` below, the public estimator's own path, may
 * ever record real consent.
 */
export async function findOrCreateCustomer(
  db: Queryable,
  session: AuthSession,
  input: CustomerInput,
): Promise<Customer> {
  validateCustomerInput(input);
  const existing = await customersRepo.findCustomerByEmail(db, session.businessId, input.email);
  if (existing) return existing;
  return customersRepo.createCustomer(db, session.businessId, { name: input.name, email: input.email, phone: input.phone });
}

/**
 * Creates a customer for a business resolved server-side, WITHOUT matching
 * against records that already exist. This is the unauthenticated
 * `/estimate/*` wizard's path (see `createQuotePublic`): a visitor there has
 * proved nothing about who they are, so an email they typed must never be
 * allowed to resolve to a `Customer` the business already holds — doing so
 * would hand an anonymous caller that customer's real name, phone, and
 * address back, and let a guessed email attach a quote to a real person's
 * record. Duplicate customer rows from a returning customer are the
 * deliberate trade-off; they are a data-tidiness problem a business can
 * reconcile, not a disclosure. Deliberately not re-exported from the
 * package's `index.ts` — `findOrCreateCustomer` above stays the only
 * customer-creating path a signed-in caller gets.
 */
/**
 * Twilio A2P 10DLC compliance (see
 * docs/decisions/0029-sms-consent-and-a2p-10dlc.md): `input.smsConsent` only
 * ever results in recorded consent when a real phone number was also
 * submitted — a checked box with no number to text is not meaningful
 * consent, and must never let a later edit that ADDS a phone number
 * retroactively "activate" it (see `isCustomerSmsEligible` for why the
 * inverse is also guarded: a phone number alone is never consent either).
 * `smsConsentSource`/`smsConsentDisclosureVersion` are stamped here, not
 * accepted from the caller — this is the one legitimate consent-granting
 * surface (the public estimator itself has no session to misuse).
 */
export async function createCustomerForBusiness(
  db: Queryable,
  businessId: string,
  input: CustomerInput,
): Promise<Customer> {
  validateCustomerInput(input);
  const hasPhone = Boolean(input.phone?.trim());
  const smsConsent = input.smsConsent === true && hasPhone;
  return customersRepo.createCustomer(db, businessId, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    smsConsent,
    smsConsentSource: smsConsent ? SMS_CONSENT_SOURCE_PUBLIC_ESTIMATOR : undefined,
    smsConsentDisclosureVersion: smsConsent ? SMS_CONSENT_DISCLOSURE_VERSION : undefined,
  });
}

/** Same "a business can't consent on a customer's behalf" reasoning as `findOrCreateCustomer` — never forwards `input.smsConsent`, so editing a customer's details from the dashboard can never grant or change their SMS consent. */
export async function updateCustomer(
  db: Queryable,
  session: AuthSession,
  id: string,
  input: CustomerInput,
): Promise<Customer> {
  validateCustomerInput(input);
  const updated = await customersRepo.updateCustomer(db, session.businessId, id, {
    name: input.name,
    email: input.email,
    phone: input.phone,
  });
  if (!updated) throw new Error(`Customer "${id}" not found.`);
  return updated;
}

/**
 * The one required gate before ANY future feature may send an automated
 * SMS to a customer's own phone (as opposed to `quoteSmsAlert.ts`'s
 * business-owner alert, which is unrelated — it never texts a customer).
 * No code path in this codebase sends a customer-facing SMS today; this
 * exists so that when one is built, it has no way to skip consent by
 * accident. Deliberately checks `phone` again here, not just `smsConsent`
 * — belt-and-suspenders against a future direct DB read or a hand-built
 * `Customer`-shaped object that never went through `createCustomerForBusiness`'s
 * own guard above.
 */
export function isCustomerSmsEligible(customer: Pick<Customer, "phone" | "smsConsent">): boolean {
  return customer.smsConsent === true && Boolean(customer.phone?.trim());
}
