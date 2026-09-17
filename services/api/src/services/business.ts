import type { DatabaseSync } from "node:sqlite";
import type { Business } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import { getBusinessById, updateBusiness, type UpdateBusinessInput } from "../repositories/businesses";

export type { UpdateBusinessInput };

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

function validateUpdateBusinessInput(input: UpdateBusinessInput): void {
  if (input.name.trim().length === 0) {
    throw new Error("Business name is required.");
  }
  if (!EMAIL_PATTERN.test(input.email)) {
    throw new Error("A valid business email is required.");
  }
}

/**
 * The one deliberate exception to "every lookup is scoped by an
 * AuthSession": the public, unauthenticated `/estimate/*` customer wizard
 * has no session — it needs to know which business it's collecting an
 * estimate FOR before one exists. Real multi-business public routing
 * (a slug per business, a subdomain, ...) is out of Phase 9's scope; this
 * resolves to whichever business signed up first, so local dev and a
 * single seeded business both work today. See
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md for why this
 * is called out rather than silently built.
 */
export function getDefaultPublicBusiness(db: DatabaseSync): Business | undefined {
  const row = db.prepare(`SELECT id FROM businesses ORDER BY created_at ASC LIMIT 1`).get() as
    | { id: string }
    | undefined;
  return row ? getBusinessById(db, row.id) : undefined;
}

/**
 * For the public, read-only `/quote/[id]` view to show which business the
 * quote it already legitimately has belongs to — not a general "look up
 * any business" escape hatch. See `services/quotes.ts`'s `getQuotePublic`,
 * which has the same access-control caveat.
 */
export function getBusinessForPublicQuote(db: DatabaseSync, businessId: string): Business | undefined {
  return getBusinessById(db, businessId);
}

/** There is no "get any business by id" in the public surface — a session can only ever resolve to its own business. */
export function getCurrentBusiness(db: DatabaseSync, session: AuthSession): Business {
  const business = getBusinessById(db, session.businessId);
  if (!business) throw new Error(`Business "${session.businessId}" not found.`);
  return business;
}

export function updateCurrentBusiness(
  db: DatabaseSync,
  session: AuthSession,
  input: UpdateBusinessInput,
): Business {
  validateUpdateBusinessInput(input);
  return updateBusiness(db, session.businessId, input);
}
