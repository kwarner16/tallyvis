import type { AuthUser } from "../types";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/** Internal row shape only — `password_hash` must never leave this file as part of a returned object. Nullable since migration 0008: a Google-only account has no password credential (see docs/decisions/0019 — never a fake placeholder hash). */
interface UserRow {
  id: string;
  business_id: string;
  email: string;
  password_hash: string | null;
  created_at: string;
  is_admin: boolean;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    businessId: row.business_id,
    createdAt: row.created_at,
    isAdmin: row.is_admin,
  };
}

/** `passwordHash: null` creates a Google-only account (see docs/decisions/0019) — never a fake/placeholder hash standing in for "no password." */
export async function createUser(
  db: Queryable,
  businessId: string,
  email: string,
  passwordHash: string | null,
): Promise<AuthUser> {
  const id = makeId("user");
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO users (id, business_id, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, businessId, email, passwordHash, createdAt],
  );
  return { id, businessId, email, createdAt, isAdmin: false };
}

/** For login only — the one place the password hash is allowed to leave the repository, and it goes straight into `verifyPassword`, never further. `passwordHash: null` means this is a Google-only account — `logIn`'s caller must reject it with the same generic message a wrong password would get, never a distinct "this account has no password" error (that would leak account-existence/auth-method information). */
export async function getUserWithPasswordHashByEmail(
  db: Queryable,
  email: string,
): Promise<{ user: AuthUser; passwordHash: string | null } | undefined> {
  const result = await db.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
  const row = result.rows[0];
  if (!row) return undefined;
  return { user: toAuthUser(row), passwordHash: row.password_hash };
}

export async function getUserById(db: Queryable, id: string): Promise<AuthUser | undefined> {
  const result = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toAuthUser(row) : undefined;
}

/** Display-only signal for Settings ("Signed in with Google" vs. showing password controls) — never used for any auth decision, only UI copy. */
export async function userHasPassword(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  return Boolean(result.rows[0]?.password_hash);
}

/** Password reset's one write — never called with a plaintext password, only an already-hashed one (see `auth/password.ts`'s `hashPassword`). Also how a Google-only user acquires a real password for the first time, if that's ever built — this function doesn't distinguish the two cases. */
export async function updatePasswordHash(db: Queryable, userId: string, passwordHash: string): Promise<void> {
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
}

/** Looks a user up by email for the one-off `grantAdmin` CLI script (see docs/decisions/0035-admin-dashboard.md) — never reachable from any customer-facing request path. Deliberately distinct from `getUserWithPasswordHashByEmail` so that function's "also returns the password hash" contract is never accidentally reused somewhere a hash shouldn't leave this file. */
export async function getUserByEmail(db: Queryable, email: string): Promise<AuthUser | undefined> {
  const result = await db.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
  const row = result.rows[0];
  return row ? toAuthUser(row) : undefined;
}

/** Every user row for one business, oldest first — the first (oldest) row is that business's original owner. Used only by the admin dashboard's business detail page (see docs/decisions/0035-admin-dashboard.md); every customer-facing path already knows which single user it's dealing with via the session, and has no reason to list a business's other users. */
export async function listUsersForBusiness(db: Queryable, businessId: string): Promise<AuthUser[]> {
  const result = await db.query<UserRow>(`SELECT * FROM users WHERE business_id = $1 ORDER BY created_at ASC`, [
    businessId,
  ]);
  return result.rows.map(toAuthUser);
}

/** The only write path for `users.is_admin` — called exclusively from the `grantAdmin` CLI script, never from any apps/app Server Action or API route. There is deliberately no UI control anywhere that can flip this flag. */
export async function setUserIsAdmin(db: Queryable, userId: string, isAdmin: boolean): Promise<void> {
  await db.query(`UPDATE users SET is_admin = $1 WHERE id = $2`, [isAdmin, userId]);
}
