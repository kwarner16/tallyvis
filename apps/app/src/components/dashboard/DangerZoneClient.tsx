"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { deleteAccountAction, type DeleteAccountState } from "@/lib/accountActions";

const REQUIRED_CONFIRMATION = "DELETE";

const initialState: DeleteAccountState = {};

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Requires
 * typing "DELETE" verbatim — no casual one-click action for something
 * this irreversible. Copy is deliberately precise about what deletion
 * does and doesn't do: it removes Tallyvis application data and access;
 * it does not imply Stripe's own financial/accounting records are erased
 * (they aren't — see `services/accountDeletion.ts`).
 */
export function DangerZoneClient() {
  const [state, formAction, pending] = useActionState(deleteAccountAction, initialState);

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/40 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Danger zone</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">Delete account</h2>
      <p className="mt-2 text-sm text-ink-soft">
        This permanently deletes your Tallyvis business, dashboard access, customers, quotes, and pricing
        configuration. If you have an active subscription, it will be canceled with Stripe first. This does{" "}
        <span className="font-medium text-ink">not</span> erase Stripe&rsquo;s own payment or invoice
        history — those financial records remain with Stripe as required for accounting purposes. This
        cannot be undone.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:max-w-sm">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            Type <span className="font-mono">{REQUIRED_CONFIRMATION}</span> to confirm
          </span>
          <input
            type="text"
            name="confirmation"
            autoComplete="off"
            className="rounded-lg border border-red-300 bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          />
        </label>

        {state.error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className={buttonVariants({ variant: "destructive", className: "self-start" })}
        >
          {pending ? "Deleting…" : "Permanently delete my account"}
        </button>
      </form>
    </div>
  );
}
