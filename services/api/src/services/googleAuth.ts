import { windowCleaningDefaultPricingRules } from "@tallyvis/config";
import { createSession, type AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isUniqueViolation } from "../db/pg/client";
import { createBusiness } from "../repositories/businesses";
import { createUser, getUserWithPasswordHashByEmail } from "../repositories/users";
import { createAuthIdentity, getIdentityByProviderAccountId } from "../repositories/authIdentities";
import { createInitialPricingConfiguration } from "../repositories/pricingConfigurations";
import type { VerifiedGoogleIdentity } from "../auth/googleOAuth";

/**
 * Account-linking policy for Google sign-in (see
 * docs/decisions/0019-account-settings-and-google-auth.md, Part 21). This
 * is the security-critical part of the whole feature — `googleOAuth.ts`
 * only proves "this really is Google's `sub`/`email` for this user," it's
 * this file's job to decide what that's allowed to DO to an account.
 *
 * The core rule: an OAuth identity is only ever attached to an account
 * when the caller can already prove some other form of control over that
 * account. There are exactly two ways to prove that here:
 *   1. The identity itself is already linked (returning Google user) —
 *      proof is the previous linking.
 *   2. The caller already holds a valid Tallyvis session (they're logged
 *      in — via password or a different linked provider — right now) and
 *      is explicitly connecting Google from Settings.
 * Never a third way: a bare "the email matches" is NOT treated as proof
 * of control, because emails are attacker-suppliable (register
 * `victim@example.com` first, then sign in with Google as the real
 * `victim@gmail.com` and hope it silently links) — see Part 21's
 * "ambiguity" cases. A collision with an existing account and no active
 * session is always rejected, never silently linked or silently
 * logged in.
 */
export class GoogleSignInError extends Error {}

export type GoogleAuthOutcome =
  | { kind: "login"; session: AuthSession; token: string }
  | { kind: "signup"; session: AuthSession; token: string }
  | { kind: "linked"; session: AuthSession };

const GOOGLE_PROVIDER = "google";

/**
 * `currentSession`, when present, means the browser already holds a valid
 * Tallyvis session at the moment the Google callback lands — i.e. this is
 * an explicit "Connect Google" action from Settings, not a fresh sign-in
 * attempt. Callers must only pass a session they've already validated
 * (`resolveSession`), never a raw cookie value.
 */
export async function signInWithGoogle(
  db: Queryable,
  identity: VerifiedGoogleIdentity,
  currentSession?: AuthSession,
): Promise<GoogleAuthOutcome> {
  const existing = await getIdentityByProviderAccountId(db, GOOGLE_PROVIDER, identity.sub);

  if (existing) {
    if (currentSession && currentSession.userId !== existing.userId) {
      // Logged in as one account, but this Google identity is already
      // linked to a DIFFERENT one — refuse rather than guess which the
      // caller meant.
      throw new GoogleSignInError(
        "This Google account is already connected to a different Tallyvis account.",
      );
    }
    // Returning Google user (or re-confirming an already-linked identity
    // while logged in as its own owner) — the previous linking is the
    // proof of control, safe to log in. `currentSession.businessId` is
    // already known-correct when present (we just checked it matches
    // `existing.userId` above); otherwise look it up.
    const businessId = currentSession?.businessId ?? (await businessIdForUser(db, existing.userId));
    const token = await createSession(db, existing.userId, businessId);
    return { kind: "login", session: { userId: existing.userId, businessId }, token };
  }

  if (currentSession) {
    // Explicit "Connect Google" from Settings while already authenticated
    // — the active session IS the proof of control. Still require a
    // verified email: an unverified Google email is not Google vouching
    // for anything.
    if (!identity.emailVerified) {
      throw new GoogleSignInError("Your Google account's email isn't verified, so it can't be connected.");
    }
    try {
      await createAuthIdentity(db, currentSession.userId, {
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.sub,
        email: identity.email,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Lost a race against a concurrent link of the same Google identity
        // (to this account or another) — same safe, generic outcome either way.
        throw new GoogleSignInError("This Google account is already connected to another account.");
      }
      throw err;
    }
    return { kind: "linked", session: currentSession };
  }

  // Fresh sign-in attempt, no existing identity, not already logged in.
  const collision = await getUserWithPasswordHashByEmail(db, identity.email);
  if (collision) {
    // An account with this email already exists but has never linked this
    // Google identity. Do NOT auto-link on email match alone (see this
    // file's module comment) — require the owner to log in normally and
    // link Google from Settings instead, which routes through the
    // `currentSession` branch above.
    throw new GoogleSignInError(
      "An account already exists for this email. Log in with your password, then connect Google from Settings.",
    );
  }

  if (!identity.emailVerified) {
    throw new GoogleSignInError("Your Google account's email isn't verified, so you can't sign up with it.");
  }

  return createAccountFromGoogle(db, identity);
}

async function businessIdForUser(db: Queryable, userId: string): Promise<string> {
  const result = await db.query<{ business_id: string }>(`SELECT business_id FROM users WHERE id = $1`, [userId]);
  const row = result.rows[0];
  if (!row) throw new Error(`User "${userId}" not found.`);
  return row.business_id;
}

/**
 * Brand-new tenant from a Google identity — mirrors `services/auth.ts`'s
 * `signUp` (same starter pricing configuration, same "business row first,
 * then user, then session, all in one transaction" shape) but with
 * `passwordHash: null` (a Google-only account has no password credential —
 * never a fake placeholder hash) and an `auth_identities` row instead of a
 * password check. Ends up at the same place a password signup does
 * (`/dashboard`), not a separate onboarding path, so both signup routes
 * share one in-dashboard onboarding experience rather than two.
 */
async function createAccountFromGoogle(db: Queryable, identity: VerifiedGoogleIdentity): Promise<GoogleAuthOutcome> {
  const businessName = deriveBusinessName(identity.email);

  try {
    return await db.transaction(async (tx) => {
      const business = await createBusiness(tx, { name: businessName, email: identity.email, needsOnboarding: true });
      await createInitialPricingConfiguration(tx, business.id, windowCleaningDefaultPricingRules);
      const user = await createUser(tx, business.id, identity.email, null);
      await createAuthIdentity(tx, user.id, {
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.sub,
        email: identity.email,
      });
      const token = await createSession(tx, user.id, business.id);
      return { kind: "signup", session: { userId: user.id, businessId: business.id }, token };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race against a concurrent signup/link for the same email or
      // the same Google identity — same generic outcome as the password
      // signup path's equivalent race.
      throw new GoogleSignInError("An account already exists for this email. Please try signing in again.");
    }
    console.error("createAccountFromGoogle failed:", err);
    throw new GoogleSignInError("Could not create your account. Please try again.");
  }
}

/** A placeholder starter name only — same spirit as the password signup form's business-name field, which the owner is always free to change later in Settings. Google never supplies a business name, so one is derived from the email's local part. */
function deriveBusinessName(email: string): string {
  const localPart = email.split("@")[0] ?? "My Business";
  const words = localPart
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const name = words.join(" ") || "My Business";
  return `${name}'s Business`;
}
