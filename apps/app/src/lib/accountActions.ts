"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteAccount, AccountDeletionError, SESSION_COOKIE_NAME } from "@tallyvis/api";
import { requireContext } from "./session";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Deletion
 * itself (Stripe-first cancellation, then transactional local deletion,
 * then session revocation) all happens in `services/accountDeletion.ts`
 * — this action's only job is the confirmation gate, cookie cleanup, and
 * redirect, the same "keep cookie mutation inside a real Server Action"
 * discipline every other mutation in this app already follows.
 */
const REQUIRED_CONFIRMATION = "DELETE";

export interface DeleteAccountState {
  error?: string;
}

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== REQUIRED_CONFIRMATION) {
    return { error: `Type "${REQUIRED_CONFIRMATION}" exactly to confirm.` };
  }

  const { db, session } = await requireContext();
  try {
    await deleteAccount(db, session);
  } catch (err) {
    return {
      error: err instanceof AccountDeletionError ? err.message : "Could not delete your account. Please try again.",
    };
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login?deleted=success");
}
