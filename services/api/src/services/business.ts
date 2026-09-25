import type { Business } from "@tallyvis/types";
import { normalizeHexColor } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import type { PublicBusinessSummary } from "./quoteSharing";
import { setPassword } from "./auth";
import {
  completeOnboarding as completeOnboardingRepo,
  getBusinessById,
  getBusinessByPublicEmbedId,
  touchEmbedLastSeen,
  updateBusiness,
  type UpdateBusinessInput,
} from "../repositories/businesses";

export type { UpdateBusinessInput };

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/**
 * Validates and normalizes in one pass — `brandColor` in particular must
 * come out as a canonical uppercase six-digit hex or not at all, never an
 * arbitrary string, since it's later interpolated as a CSS custom property
 * value for the public estimator (Part 14/24 of the branding work: "never
 * allow arbitrary CSS to be stored"). Throws with a message safe to show
 * the business owner directly (this only ever runs for an authenticated
 * caller updating their own settings).
 */
function normalizeUpdateBusinessInput(input: UpdateBusinessInput): UpdateBusinessInput {
  if (input.name.trim().length === 0) {
    throw new Error("Business name is required.");
  }
  if (!EMAIL_PATTERN.test(input.email)) {
    throw new Error("A valid business email is required.");
  }

  let brandColor = input.brandColor;
  if (brandColor !== undefined) {
    const normalized = normalizeHexColor(brandColor);
    if (!normalized) {
      throw new Error("Brand color must be a six-digit hex value, like #0057B8.");
    }
    brandColor = normalized;
  }

  if (input.logoUrl !== undefined && !/^https?:\/\/\S+$/i.test(input.logoUrl)) {
    throw new Error("Logo URL must be a valid http:// or https:// address.");
  }

  return { ...input, brandColor };
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
export async function getDefaultPublicBusiness(db: Queryable): Promise<Business | undefined> {
  const result = await db.query<{ id: string }>(`SELECT id FROM businesses ORDER BY created_at ASC LIMIT 1`);
  const row = result.rows[0];
  return row ? getBusinessById(db, row.id) : undefined;
}

/** There is no "get any business by id" in the public surface — a session can only ever resolve to its own business. */
export async function getCurrentBusiness(db: Queryable, session: AuthSession): Promise<Business> {
  const business = await getBusinessById(db, session.businessId);
  if (!business) throw new Error(`Business "${session.businessId}" not found.`);
  return business;
}

export async function updateCurrentBusiness(
  db: Queryable,
  session: AuthSession,
  input: UpdateBusinessInput,
): Promise<Business> {
  return updateBusiness(db, session.businessId, normalizeUpdateBusinessInput(input));
}

export interface CompleteOnboardingInput {
  businessName: string;
  /** Optional — a Google-only account may skip setting a password now and do it later from Settings (see `setPassword`). */
  password?: string;
}

/**
 * The Google-signup onboarding step's one write (2026-09 fix): sets the
 * real business name (replacing the placeholder `deriveBusinessName`
 * produced) and clears `needsOnboarding`, plus optionally establishes a
 * password credential in the same action. Password creation reuses
 * `setPassword`'s own validation/refusal rules unchanged — this function
 * adds no separate password logic of its own.
 */
export async function completeOnboarding(
  db: Queryable,
  session: AuthSession,
  input: CompleteOnboardingInput,
): Promise<Business> {
  const name = input.businessName.trim();
  if (name.length === 0) {
    throw new Error("Business name is required.");
  }
  if (input.password) {
    await setPassword(db, session, input.password);
  }
  return completeOnboardingRepo(db, session.businessId, name);
}

/**
 * Resolves a business for the public estimator embed (Phase 14 — see
 * docs/decisions/0016-onboarding-billing-embed.md). `embedId` is the one
 * piece of business identity a browser is trusted to assert directly — it
 * is the PUBLIC identifier, distinct from `id`, designed for exactly this.
 * Also records that the embed was actually loaded, for the dashboard's
 * install-status indicator.
 */
export async function resolveEmbedBusiness(db: Queryable, embedId: string): Promise<Business | undefined> {
  const business = await getBusinessByPublicEmbedId(db, embedId);
  if (business) await touchEmbedLastSeen(db, business.id);
  return business;
}

/**
 * Only what the public estimator's result page actually renders (name and
 * branding) for a business resolved by embed id, or the default public
 * business — deliberately NOT the full `Business` record. Same
 * over-exposure bug class `quoteSharing.ts`'s `PublicBusinessSummary` was
 * introduced to fix (see docs/decisions/0012), found recurring in this
 * sibling public code path during the Stripe V1 hardening audit: the full
 * record includes the owner's login email and internal database id,
 * neither of which the public estimator has any legitimate need for, and
 * because the caller (`apps/app`'s `getPublicBusinessAction`) crosses a
 * client/server boundary as a Server Action, those fields were genuinely
 * transmitted to the browser on every page load.
 */
export async function resolvePublicBusinessSummary(
  db: Queryable,
  embedId?: string,
): Promise<PublicBusinessSummary | undefined> {
  const business = embedId ? await resolveEmbedBusiness(db, embedId) : await getDefaultPublicBusiness(db);
  if (!business) return undefined;
  return { name: business.name, phone: business.phone, logoUrl: business.logoUrl, brandColor: business.brandColor };
}
