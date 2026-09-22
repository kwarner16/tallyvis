import type { DatabaseSync } from "node:sqlite";
import type { AuthUser } from "../types";
import { makeId } from "../db/ids";

/** Internal row shape only — `password_hash` must never leave this file as part of a returned object. Nullable since migration 0008: a Google-only account has no password credential (see docs/decisions/0019 — never a fake placeholder hash). */
interface UserRow {
  id: string;
  business_id: string;
  email: string;
  password_hash: string | null;
  created_at: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, businessId: row.business_id, createdAt: row.created_at };
}

/** `passwordHash: null` creates a Google-only account (see docs/decisions/0019) — never a fake/placeholder hash standing in for "no password." */
export function createUser(
  db: DatabaseSync,
  businessId: string,
  email: string,
  passwordHash: string | null,
): AuthUser {
  const id = makeId("user");
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, business_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, businessId, email, passwordHash, createdAt);
  return { id, businessId, email, createdAt };
}

/** For login only — the one place the password hash is allowed to leave the repository, and it goes straight into `verifyPassword`, never further. `passwordHash: null` means this is a Google-only account — `logIn`'s caller must reject it with the same generic message a wrong password would get, never a distinct "this account has no password" error (that would leak account-existence/auth-method information). */
export function getUserWithPasswordHashByEmail(
  db: DatabaseSync,
  email: string,
): { user: AuthUser; passwordHash: string | null } | undefined {
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  if (!row) return undefined;
  return { user: toAuthUser(row), passwordHash: row.password_hash };
}

export function getUserById(db: DatabaseSync, id: string): AuthUser | undefined {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toAuthUser(row) : undefined;
}

/** Display-only signal for Settings ("Signed in with Google" vs. showing password controls) — never used for any auth decision, only UI copy. */
export function userHasPassword(db: DatabaseSync, userId: string): boolean {
  const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as
    | { password_hash: string | null }
    | undefined;
  return Boolean(row?.password_hash);
}

/** Password reset's one write — never called with a plaintext password, only an already-hashed one (see `auth/password.ts`'s `hashPassword`). Also how a Google-only user acquires a real password for the first time, if that's ever built — this function doesn't distinguish the two cases. */
export function updatePasswordHash(db: DatabaseSync, userId: string, passwordHash: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
}
