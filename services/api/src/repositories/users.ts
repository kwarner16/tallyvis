import type { DatabaseSync } from "node:sqlite";
import type { AuthUser } from "../types";
import { makeId } from "../db/ids";

/** Internal row shape only — `password_hash` must never leave this file as part of a returned object. */
interface UserRow {
  id: string;
  business_id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, businessId: row.business_id, createdAt: row.created_at };
}

export function createUser(
  db: DatabaseSync,
  businessId: string,
  email: string,
  passwordHash: string,
): AuthUser {
  const id = makeId("user");
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, business_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, businessId, email, passwordHash, createdAt);
  return { id, businessId, email, createdAt };
}

/** For login only — the one place the password hash is allowed to leave the repository, and it goes straight into `verifyPassword`, never further. */
export function getUserWithPasswordHashByEmail(
  db: DatabaseSync,
  email: string,
): { user: AuthUser; passwordHash: string } | undefined {
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  if (!row) return undefined;
  return { user: toAuthUser(row), passwordHash: row.password_hash };
}

export function getUserById(db: DatabaseSync, id: string): AuthUser | undefined {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toAuthUser(row) : undefined;
}

/** Password reset's one write — never called with a plaintext password, only an already-hashed one (see `auth/password.ts`'s `hashPassword`). */
export function updatePasswordHash(db: DatabaseSync, userId: string, passwordHash: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
}
