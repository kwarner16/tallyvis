"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import type { SalesProspect } from "@tallyvis/api";
import { updateProspectAction, type ProspectFormState } from "@/lib/salesAdminActions";

const initialState: ProspectFormState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/** Lets Kyle correct contact info an import got wrong — see docs/decisions/0041's own requirement. */
export function EditProspectForm({ prospect }: { prospect: SalesProspect }) {
  const [state, formAction, pending] = useActionState(updateProspectAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="prospectId" value={prospect.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="businessName" className="text-sm font-medium text-ink">
            Business name
          </label>
          <input id="businessName" name="businessName" type="text" required defaultValue={prospect.businessName} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contactName" className="text-sm font-medium text-ink">
            Owner / contact
          </label>
          <input id="contactName" name="contactName" type="text" defaultValue={prospect.contactName} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium text-ink">
            Phone
          </label>
          <input id="phone" name="phone" type="text" required defaultValue={prospect.phone} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={prospect.email} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="website" className="text-sm font-medium text-ink">
            Website
          </label>
          <input id="website" name="website" type="text" defaultValue={prospect.website} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="source" className="text-sm font-medium text-ink">
            Source
          </label>
          <input id="source" name="source" type="text" defaultValue={prospect.source} disabled className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="city" className="text-sm font-medium text-ink">
            City
          </label>
          <input id="city" name="city" type="text" defaultValue={prospect.city} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="state" className="text-sm font-medium text-ink">
            State
          </label>
          <input id="state" name="state" type="text" defaultValue={prospect.state} className={INPUT_CLASS} />
        </div>
      </div>

      {state.error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

      <button type="submit" disabled={pending} className={buttonVariants({ variant: "primary", className: "self-start" })}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
