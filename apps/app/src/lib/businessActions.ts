"use server";

import { revalidatePath } from "next/cache";
import type { Business } from "@tallyvis/types";
import {
  completeOnboarding,
  setPassword,
  updateCurrentBusiness,
  type CompleteOnboardingInput,
  type UpdateBusinessInput,
} from "@tallyvis/api";
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

/**
 * The Google-signup onboarding step (2026-09 fix) — `requireContext()`
 * derives the business/user from the session exactly like every other
 * action in this file. Clears `business.needsOnboarding` on success, so
 * `dashboard/layout.tsx`'s gate lets the real dashboard through on the
 * next render.
 */
export async function completeOnboardingAction(input: CompleteOnboardingInput): Promise<ActionResult<Business>> {
  const { db, session } = await requireContext();
  try {
    const business = await completeOnboarding(db, session, input);
    revalidatePath("/dashboard");
    return { ok: true, data: business };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not finish setting up your account." };
  }
}

/**
 * "Create password" for a Google-only account with no password credential
 * yet (2026-09 fix) — distinct from the existing forgot-password/reset
 * flow (Settings' "Change password" link), which remains untouched and is
 * still how an account that already has a password changes it.
 */
export async function setPasswordAction(newPassword: string): Promise<ActionResult<null>> {
  const { db, session } = await requireContext();
  try {
    await setPassword(db, session, newPassword);
    revalidatePath("/dashboard/settings");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not set a password." };
  }
}
