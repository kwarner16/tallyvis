/**
 * Founder-only operational script: grants (or revokes) internal TallyVis
 * CEO/Admin dashboard access for one named account — see
 * docs/decisions/0035-admin-dashboard.md. Deliberately the same shape as
 * `waiveInstallation.ts`: a one-off script a founder runs directly against
 * the database, never a dashboard feature, never reachable from any
 * customer-facing request path. There is no UI control anywhere in
 * apps/app that can set `users.is_admin` — this script is the only way.
 *
 * Usage:
 *   pnpm --filter @tallyvis/api grant-admin <email>            # grant
 *   pnpm --filter @tallyvis/api grant-admin <email> --revoke   # revoke
 */
import { getUserByEmail, setUserIsAdmin } from "../repositories/users";
import { getDb } from "./pg/client";

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email) {
    console.error("Usage: pnpm --filter @tallyvis/api grant-admin <email> [--revoke]");
    process.exit(1);
    return;
  }

  const db = getDb();
  const user = await getUserByEmail(db, email.trim().toLowerCase());
  if (!user) {
    console.error(`No account found for ${email}.`);
    process.exit(1);
    return;
  }

  await setUserIsAdmin(db, user.id, !revoke);
  console.log(
    `${revoke ? "Revoked" : "Granted"} admin access for ${email} (user ${user.id}, business ${user.businessId}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
