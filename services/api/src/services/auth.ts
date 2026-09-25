import { windowCleaningDefaultPricingRules } from "@tallyvis/config";
import { createSession, revokeSession, validateSession, type AuthSession } from "../auth/session";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY } from "../auth/password";
import type { Queryable } from "../db/pg/client";
import { isUniqueViolation } from "../db/pg/client";
import { createBusiness } from "../repositories/businesses";
import {
  createUser,
  getUserById,
  getUserWithPasswordHashByEmail,
  updatePasswordHash,
  userHasPassword,
} from "../repositories/users";
import { listIdentitiesForUser } from "../repositories/authIdentities";
import { createInitialPricingConfiguration } from "../repositories/pricingConfigurations";

const EMAIL_PATTERN = /\S+@\S+\.\S+/;
const MIN_PASSWORD_LENGTH = 8;

export interface SignUpInput {
  businessName: string;
  ownerEmail: string;
  password: string;
}

export interface AuthResult {
  session: AuthSession;
  token: string;
}

function validateSignUpInput(input: SignUpInput): void {
  if (input.businessName.trim().length === 0) {
    throw new Error("Business name is required.");
  }
  if (!EMAIL_PATTERN.test(input.ownerEmail)) {
    throw new Error("A valid email address is required.");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/**
 * Creates a brand-new tenant: a `Business`, its owner `User`, a starter
 * `PricingConfiguration` (the same default rate card `demoPricingConfiguration`
 * uses, so a new business isn't quoting against empty rules on day one), and
 * a session for the newly created user. Everything after the business row
 * itself is created scoped to that business's id — nothing here accepts a
 * businessId from the caller.
 *
 * The application-level uniqueness check below is a courtesy that produces
 * a good error message, not the guarantee: hashing the password is an
 * `await`, so two concurrent signups for the same email can both get past
 * it. `users.email UNIQUE` is what actually holds, and the writes run
 * inside a transaction (`withTransaction`), so the loser of that race hits
 * the constraint and rolls back rather than leaving an orphaned business or
 * pricing configuration behind. Both outcomes surface as the same
 * "already exists" message. Any other unexpected error is logged
 * server-side and translated to a generic message — never a raw database
 * error — before reaching the caller.
 */
export async function signUp(db: Queryable, input: SignUpInput): Promise<AuthResult> {
  validateSignUpInput(input);

  const email = input.ownerEmail.trim().toLowerCase();
  if (await getUserWithPasswordHashByEmail(db, email)) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx) => {
      const business = await createBusiness(tx, { name: input.businessName.trim(), email });
      await createInitialPricingConfiguration(tx, business.id, windowCleaningDefaultPricingRules);
      const user = await createUser(tx, business.id, email, passwordHash);
      const token = await createSession(tx, user.id, business.id);
      return { session: { userId: user.id, businessId: business.id }, token };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error("An account with this email already exists.");
    }
    console.error("signUp failed:", err);
    throw new Error("Could not create your account. Please try again.");
  }
}

export interface LogInInput {
  email: string;
  password: string;
}

/**
 * Deliberately the same error for "no such user" and "wrong password" —
 * distinguishing them lets an attacker enumerate registered emails.
 * `verifyPassword` is also called unconditionally, even when no account
 * exists (against a fixed dummy hash in that case) — hardening against a
 * timing side-channel: skipping the (deliberately slow, cost-12 bcrypt)
 * comparison entirely for a nonexistent email would make that response
 * measurably faster than a real wrong-password attempt, letting an
 * attacker enumerate emails via response time even with an identical
 * error message.
 */
export async function logIn(db: Queryable, input: LogInInput): Promise<AuthResult> {
  const record = await getUserWithPasswordHashByEmail(db, input.email.trim().toLowerCase());
  const valid = await verifyPassword(input.password, record?.passwordHash ?? DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY);
  if (!record || !valid) throw new Error("Invalid email or password.");

  const token = await createSession(db, record.user.id, record.user.businessId);
  return { session: { userId: record.user.id, businessId: record.user.businessId }, token };
}

export async function logOut(db: Queryable, token: string | undefined): Promise<void> {
  await revokeSession(db, token);
}

/** The one function every protected server action/page must call before touching business data. Returns `undefined` for a missing/invalid/expired session — never throws, so callers decide how to handle "not signed in" (usually: redirect). */
export async function resolveSession(db: Queryable, token: string | undefined): Promise<AuthSession | undefined> {
  return validateSession(db, token);
}

export interface CurrentUserInfo {
  id: string;
  email: string;
  createdAt: string;
  /** Display-only — never used for any auth decision. A Google-only account (no password credential) has this false. */
  hasPassword: boolean;
  /** e.g. ["google"] — for Settings' "Signed in with Google" indicator. Empty for a password-only account. */
  linkedProviders: string[];
}

/** For the Settings "Account" section — who am I signed in as, and how. */
export async function getCurrentUser(db: Queryable, session: AuthSession): Promise<CurrentUserInfo> {
  const user = await getUserById(db, session.userId);
  if (!user) throw new Error(`User "${session.userId}" not found.`);
  const [hasPassword, identities] = await Promise.all([
    userHasPassword(db, session.userId),
    listIdentitiesForUser(db, session.userId),
  ]);
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    hasPassword,
    linkedProviders: identities.map((identity) => identity.provider),
  };
}

/**
 * Establishes a password credential for the FIRST time (a Google-only
 * account acquiring email/password login) — deliberately distinct from a
 * password change, which goes through `passwordReset.ts`'s token flow
 * instead (see docs/decisions and the 2026-09 onboarding fix: "Create
 * password" vs. "Change password" are different UX and different code
 * paths, not the same action with a different label). Refuses outright
 * if this account already has a password — a real change must go through
 * the reset-token flow, which correctly requires proving control via
 * email rather than trusting an active session alone to overwrite an
 * existing credential silently.
 */
export async function setPassword(db: Queryable, session: AuthSession, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await userHasPassword(db, session.userId)) {
    throw new Error("This account already has a password — use the change-password flow instead.");
  }
  const passwordHash = await hashPassword(newPassword);
  await updatePasswordHash(db, session.userId, passwordHash);
}
