import type { DatabaseSync } from "node:sqlite";
import { windowCleaningDefaultPricingRules } from "@tallyvis/config";
import { createSession, revokeSession, validateSession, type AuthSession } from "../auth/session";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY } from "../auth/password";
import { createBusiness } from "../repositories/businesses";
import { createUser, getUserById, getUserWithPasswordHashByEmail, userHasPassword } from "../repositories/users";
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
 * inside a transaction, so the loser of that race hits the constraint and
 * rolls back rather than leaving an orphaned business or pricing
 * configuration behind. Both outcomes surface as the same
 * "already exists" message. Any other unexpected error is logged
 * server-side and translated to a generic message — never a raw database
 * error — before reaching the caller.
 */
export async function signUp(db: DatabaseSync, input: SignUpInput): Promise<AuthResult> {
  validateSignUpInput(input);

  const email = input.ownerEmail.trim().toLowerCase();
  if (getUserWithPasswordHashByEmail(db, email)) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  db.exec("BEGIN");
  try {
    const business = createBusiness(db, { name: input.businessName.trim(), email });
    createInitialPricingConfiguration(db, business.id, windowCleaningDefaultPricingRules);
    const user = createUser(db, business.id, email, passwordHash);
    const token = createSession(db, user.id, business.id);
    db.exec("COMMIT");
    return { session: { userId: user.id, businessId: business.id }, token };
  } catch (err) {
    db.exec("ROLLBACK");
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
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
export async function logIn(db: DatabaseSync, input: LogInInput): Promise<AuthResult> {
  const record = getUserWithPasswordHashByEmail(db, input.email.trim().toLowerCase());
  const valid = await verifyPassword(input.password, record?.passwordHash ?? DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY);
  if (!record || !valid) throw new Error("Invalid email or password.");

  const token = createSession(db, record.user.id, record.user.businessId);
  return { session: { userId: record.user.id, businessId: record.user.businessId }, token };
}

export function logOut(db: DatabaseSync, token: string | undefined): void {
  revokeSession(db, token);
}

/** The one function every protected server action/page must call before touching business data. Returns `undefined` for a missing/invalid/expired session — never throws, so callers decide how to handle "not signed in" (usually: redirect). */
export function resolveSession(db: DatabaseSync, token: string | undefined): AuthSession | undefined {
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
export function getCurrentUser(db: DatabaseSync, session: AuthSession): CurrentUserInfo {
  const user = getUserById(db, session.userId);
  if (!user) throw new Error(`User "${session.userId}" not found.`);
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    hasPassword: userHasPassword(db, session.userId),
    linkedProviders: listIdentitiesForUser(db, session.userId).map((identity) => identity.provider),
  };
}
