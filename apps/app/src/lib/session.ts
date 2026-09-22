import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, resolveSession, SESSION_COOKIE_NAME, type AuthSession } from "@tallyvis/api";

/**
 * Server-only (imports `next/headers`, which errors if pulled into a
 * client component) — the one place apps/app reads the session cookie.
 * Every dashboard page/Server Action goes through `requireContext()`
 * rather than trusting anything the browser sends about who's signed in.
 */

export interface RequestContext {
  db: ReturnType<typeof getDb>;
  session: AuthSession;
}

async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

export async function getOptionalSession(): Promise<AuthSession | undefined> {
  const token = await readSessionToken();
  return await resolveSession(getDb(), token);
}

/**
 * Resolves the current business/user context from the session cookie, or
 * redirects to `/login` if there isn't a valid one. This — not any
 * client-supplied businessId — is where every dashboard data access starts.
 */
export async function requireContext(): Promise<RequestContext> {
  const db = getDb();
  const token = await readSessionToken();
  const session = await resolveSession(db, token);
  if (!session) redirect("/login");
  return { db, session };
}
