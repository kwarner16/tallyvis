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
