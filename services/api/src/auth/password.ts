import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Established, vetted password hashing (bcrypt) — never write custom password crypto. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * A fixed, precomputed bcrypt hash with no corresponding real password —
 * used only to burn an equivalent amount of time when a login attempt
 * targets an email with no account, so "no such user" and "wrong
 * password" take the same amount of time as well as returning the same
 * error message. Computed once at module load (a one-time server-startup
 * cost), not per request. See `services/auth.ts`'s `logIn` — without
 * this, skipping `verifyPassword` entirely for a nonexistent email is
 * measurably faster than running it for a wrong password, letting an
 * attacker enumerate registered emails purely via response timing even
 * though the error message never differs.
 */
export const DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY = bcrypt.hashSync("not-a-real-password", SALT_ROUNDS);
