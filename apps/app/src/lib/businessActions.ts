"use server";

import { revalidatePath } from "next/cache";
import type { Business } from "@tallyvis/types";
import { updateCurrentBusiness, type UpdateBusinessInput } from "@tallyvis/api";
import { requireContext } from "./session";
import type { ActionResult } from "./actionResult";

/**
 * `updateCurrentBusiness` only ever throws its own hand-written validation
 * messages (name/email required, brand color must be a six-digit hex,
 * logo URL must be http(s)) — safe to show verbatim. Returned rather than
 * thrown so a production build doesn't strip the message (see
 * actionResult.ts).
 */
export async function updateBusinessAction(input: UpdateBusinessInput): Promise<ActionResult<Business>> {
  const { db, session } = await requireContext();
  try {
    const business = await updateCurrentBusiness(db, session, input);
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { ok: true, data: business };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save settings." };
  }
}
