import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * See docs/decisions/0019-account-settings-and-google-auth.md and
 * migration `db/pg/migrations/0005_google_auth.sql`. One row per linked
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
export async function getIdentityByProviderAccountId(
  db: Queryable,
  provider: string,
  providerAccountId: string,
): Promise<AuthIdentity | undefined> {
  const result = await db.query<AuthIdentityRow>(
    `SELECT * FROM auth_identities WHERE provider = $1 AND provider_account_id = $2`,
    [provider, providerAccountId],
  );
  const row = result.rows[0];
  return row ? toAuthIdentity(row) : undefined;
}

/** For display only ("Signed in with Google") — never used for lookup/authorization. */
export async function listIdentitiesForUser(db: Queryable, userId: string): Promise<AuthIdentity[]> {
  const result = await db.query<AuthIdentityRow>(`SELECT * FROM auth_identities WHERE user_id = $1`, [userId]);
  return result.rows.map(toAuthIdentity);
}

/**
 * Links a new identity to an existing user. The caller is responsible for
 * every account-linking policy decision (verified email, no silent
 * takeover, etc. — see docs/decisions/0019) — this function only performs
 * the insert, guarded by the same `(provider, providerAccountId)` unique
 * index the schema already enforces (a duplicate insert throws rather
 * than silently succeeding twice).
 */
export async function createAuthIdentity(
  db: Queryable,
  userId: string,
  input: { provider: string; providerAccountId: string; email: string },
): Promise<AuthIdentity> {
  const id = makeId("identity");
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO auth_identities (id, user_id, provider, provider_account_id, email, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, input.provider, input.providerAccountId, input.email, createdAt],
  );
  return { id, userId, provider: input.provider, providerAccountId: input.providerAccountId, email: input.email, createdAt };
}
