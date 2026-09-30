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
  updateSmsNotificationSettings as updateSmsNotificationSettingsRepo,
  type UpdateBusinessInput,
} from "../repositories/businesses";

export type { UpdateBusinessInput };

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/** A bare 10-digit US number, or one already prefixed with a leading "1" (11 digits). Matches the vertical's current US-only market — see this function's own comment. */
const US_PHONE_PATTERN = /^\d{10}$/;
const US_PHONE_WITH_COUNTRY_CODE_PATTERN = /^1\d{10}$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Normalizes a business's own SMS-notification phone number to E.164, or
 * returns `null` if the input isn't a plausible phone number at all.
 * Deliberately never silently drops/ignores an unparseable value — the
 * caller (`updateSmsNotificationSettings` below) rejects it with an error
 * the business owner can act on, rather than storing something that will
 * quietly fail every future send.
 *
 * Bare 10-digit numbers are assumed US/+1 — Tallyvis is a US-only product
 * today (see CLAUDE.md's phase roadmap); an already-E.164 `+`-prefixed
 * number is accepted as-is (still validated against a plausible shape) so
 * this doesn't block a future international number once that changes.
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) {
    return E164_PATTERN.test(trimmed) ? trimmed : null;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (US_PHONE_PATTERN.test(digits)) return `+1${digits}`;
  if (US_PHONE_WITH_COUNTRY_CODE_PATTERN.test(digits)) return `+${digits}`;
  return null;
}

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

export interface UpdateSmsNotificationSettingsInput {
  enabled: boolean;
  /** Raw, as typed by the business owner — normalized/validated here, never trusted as-is. Pass `undefined`/empty to clear it. */
  notificationPhone?: string;
}

/**
 * The dashboard Settings page's "SMS notifications" form. Rejects an
 * unparseable phone number outright (rather than silently disabling
 * notifications) so a typo surfaces immediately instead of as a silent,
 * permanently-missed alert later. Enabling notifications with no phone
 * number on file at all is also rejected — see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md: SMS must
 * never fire without both an explicit opt-in AND a valid number.
 */
export async function updateSmsNotificationSettings(
  db: Queryable,
  session: AuthSession,
  input: UpdateSmsNotificationSettingsInput,
): Promise<Business> {
  const trimmedPhone = input.notificationPhone?.trim();
  let normalizedPhone: string | undefined;
  if (trimmedPhone) {
    const normalized = normalizePhoneNumber(trimmedPhone);
    if (!normalized) {
      throw new Error("Enter a valid phone number, like (555) 123-4567.");
    }
    normalizedPhone = normalized;
  }

  if (input.enabled && !normalizedPhone) {
    throw new Error("Add a notification phone number before turning SMS alerts on.");
  }

  return updateSmsNotificationSettingsRepo(db, session.businessId, {
    enabled: input.enabled,
    notificationPhone: normalizedPhone,
  });
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
 * branding) for a business resolved by embed id — deliberately NOT the
 * full `Business` record. Same over-exposure bug class
 * `quoteSharing.ts`'s `PublicBusinessSummary` was introduced to fix (see
 * docs/decisions/0012), found recurring in this sibling public code path
 * during the Stripe V1 hardening audit: the full record includes the
 * owner's login email and internal database id, neither of which the
 * public estimator has any legitimate need for, and because the caller
 * (`apps/app`'s `getPublicBusinessAction`) crosses a client/server
 * boundary as a Server Action, those fields were genuinely transmitted to
 * the browser on every page load.
 *
 * Deliberately does NOT fall back to `getDefaultPublicBusiness()` when
 * `embedId` is absent (removed 2026-09 — see
 * docs/decisions/0027-direct-estimator-demo-mode.md): that fallback used
 * to resolve a real, arbitrary business (whichever signed up first) for
 * the direct, un-embedded `/estimate` wizard, which has no genuine
 * business relationship with its visitor at all — every real production
 * incident of a quote landing on the wrong business traced back to this
 * exact kind of silent default-tenant substitution. `apps/app`'s caller
 * now handles the no-`embedId` case itself, entirely without touching a
 * real business (see that file's own comment).
 */
export async function resolvePublicBusinessSummary(
  db: Queryable,
  embedId?: string,
): Promise<PublicBusinessSummary | undefined> {
  if (!embedId) return undefined;
  const business = await resolveEmbedBusiness(db, embedId);
  if (!business) return undefined;
  return { name: business.name, phone: business.phone, logoUrl: business.logoUrl, brandColor: business.brandColor };
}
