import { redirect } from "next/navigation";
import { isAdminSession } from "@tallyvis/api";
import { requireContext, type RequestContext } from "./session";

/**
 * The one gate every `/admin/*` page and every admin Server Action must
 * call (see docs/decisions/0035-admin-dashboard.md) — never a check on
 * navigation visibility, a query parameter, or anything client-side.
 * First resolves a real, validated session exactly like `requireContext()`
 * (redirecting to `/login` if there isn't one), then independently checks
 * `users.is_admin` fresh from the database. A normal authenticated
 * customer who manually visits an admin URL is bounced to their own
 * `/dashboard` — never shown an error that confirms an admin area exists
 * at that URL, and never shown any admin data en route.
 *
 * This is deliberately NOT the only enforcement point: every exported
 * function in `services/admin.ts` re-runs the same `isAdminSession` check
 * itself before touching any cross-tenant data, so a future admin route
 * that forgets to call this still cannot read real data. See that file's
 * own comment.
 */
export async function requireAdminContext(): Promise<RequestContext> {
  const context = await requireContext();
  if (!(await isAdminSession(context.db, context.session))) {
    redirect("/dashboard");
  }
  return context;
}
