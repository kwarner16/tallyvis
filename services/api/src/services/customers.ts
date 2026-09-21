import type { DatabaseSync } from "node:sqlite";
import type { Customer, CustomerInput } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
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

export function listCustomers(db: DatabaseSync, session: AuthSession): Customer[] {
  return customersRepo.listCustomers(db, session.businessId);
}

export function getCustomer(db: DatabaseSync, session: AuthSession, id: string): Customer | undefined {
  return customersRepo.getCustomerById(db, session.businessId, id);
}

/** Reuses an existing customer (matched by email, case-insensitively) for this business rather than forking a new record every time the same person is quoted again. */
export function findOrCreateCustomer(
  db: DatabaseSync,
  session: AuthSession,
  input: CustomerInput,
): Customer {
  validateCustomerInput(input);
  const existing = customersRepo.findCustomerByEmail(db, session.businessId, input.email);
  return existing ?? customersRepo.createCustomer(db, session.businessId, input);
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
export function createCustomerForBusiness(
  db: DatabaseSync,
  businessId: string,
  input: CustomerInput,
): Customer {
  validateCustomerInput(input);
  return customersRepo.createCustomer(db, businessId, input);
}

export function updateCustomer(
  db: DatabaseSync,
  session: AuthSession,
  id: string,
  input: CustomerInput,
): Customer {
  validateCustomerInput(input);
  const updated = customersRepo.updateCustomer(db, session.businessId, id, input);
  if (!updated) throw new Error(`Customer "${id}" not found.`);
  return updated;
}
