"use server";

import { after } from "next/server";
import { submitFeedback } from "@tallyvis/api";
import { requireContext } from "./session";

/**
 * Production hardening (see docs/decisions/0039-embed-logo-signup-
 * notifications-and-feedback.md) — the authenticated business dashboard's
 * "Feedback" form. `requireContext()` (not a client-supplied id) is the
 * only source of `businessId`/`userId` — see `submitFeedback`'s own
 * comment for why `input` itself carries neither.
 */

export interface FeedbackActionState {
  error?: string;
  success?: boolean;
}

export async function submitFeedbackAction(
  _prevState: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const { db, session } = await requireContext();

  try {
    await submitFeedback(
      db,
      session,
      {
        type: String(formData.get("type") ?? ""),
        message: String(formData.get("message") ?? ""),
        contactMe: formData.get("contactMe") === "on",
        sourcePath: String(formData.get("sourcePath") ?? "") || undefined,
      },
      (finished) => after(() => finished),
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not submit your feedback. Please try again." };
  }

  return { success: true };
}
