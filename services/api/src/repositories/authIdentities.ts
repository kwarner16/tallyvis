import type { DatabaseSync } from "node:sqlite";
import { makeId } from "../db/ids";

/**
 * See docs/decisions/0019-account-settings-and-google-auth.md and
 * migration `0008_google_auth_identities.sql`. One row per linked
 * external identity provider account — `providerAccountId` is the
 * provider's own stable subject identifier (Google's `sub` claim), never
 * an email, which can change and is never a trustworthy long-lived key.
 * `email` here is a denormalized, informational snapshot only (for
 * display — e.g. "Linked: name@gmail.com") — it is NEVER used to look up
 * or match an identity, only `(provider, providerAccountId)` is.
 */
export interface AuthIdentity {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  email: string;
  createdAt: string;
}

interface AuthIdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  email: string;
  created_at: string;
}

function toAuthIdentity(row: AuthIdentityRow): AuthIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    createdAt: row.created_at,
  };
}

/** The one lookup that matters for login/linking — resolves by the provider's own stable id, never by email. */
export function getIdentityByProviderAccountId(
  db: DatabaseSync,
  provider: string,
  providerAccountId: string,
): AuthIdentity | undefined {
  const row = db
    .prepare(`SELECT * FROM auth_identities WHERE provider = ? AND provider_account_id = ?`)
    .get(provider, providerAccountId) as AuthIdentityRow | undefined;
  return row ? toAuthIdentity(row) : undefined;
}

/** For display only ("Signed in with Google") — never used for lookup/authorization. */
export function listIdentitiesForUser(db: DatabaseSync, userId: string): AuthIdentity[] {
  const rows = db.prepare(`SELECT * FROM auth_identities WHERE user_id = ?`).all(userId) as unknown as AuthIdentityRow[];
  return rows.map(toAuthIdentity);
}

/**
 * Links a new identity to an existing user. The caller is responsible for
 * every account-linking policy decision (verified email, no silent
 * takeover, etc. — see docs/decisions/0019) — this function only performs
 * the insert, guarded by the same `(provider, providerAccountId)` unique
 * index the schema already enforces (a duplicate insert throws rather
 * than silently succeeding twice).
 */
export function createAuthIdentity(
  db: DatabaseSync,
  userId: string,
  input: { provider: string; providerAccountId: string; email: string },
): AuthIdentity {
  const id = makeId("identity");
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_identities (id, user_id, provider, provider_account_id, email, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.provider, input.providerAccountId, input.email, createdAt);
  return { id, userId, provider: input.provider, providerAccountId: input.providerAccountId, email: input.email, createdAt };
}
