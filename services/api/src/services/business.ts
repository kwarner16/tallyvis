import type { DatabaseSync } from "node:sqlite";
import type { Business } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import {
  getBusinessById,
  getBusinessByPublicEmbedId,
  touchEmbedLastSeen,
  updateBusiness,
  type UpdateBusinessInput,
} from "../repositories/businesses";

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

/**
 * Resolves a business for the public estimator embed (Phase 14 — see
 * docs/decisions/0016-onboarding-billing-embed.md). `embedId` is the one
 * piece of business identity a browser is trusted to assert directly — it
 * is the PUBLIC identifier, distinct from `id`, designed for exactly this.
 * Also records that the embed was actually loaded, for the dashboard's
 * install-status indicator.
 */
export function resolveEmbedBusiness(db: DatabaseSync, embedId: string): Business | undefined {
  const business = getBusinessByPublicEmbedId(db, embedId);
  if (business) touchEmbedLastSeen(db, business.id);
  return business;
}
