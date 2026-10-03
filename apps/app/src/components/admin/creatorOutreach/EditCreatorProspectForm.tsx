"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import type { CreatorProspect } from "@tallyvis/api";
import { updateCreatorProspectAction, type CreatorProspectFormState } from "@/lib/creatorOutreachActions";

const initialState: CreatorProspectFormState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/** Lets Kyle correct info an import got wrong. */
export function EditCreatorProspectForm({ prospect }: { prospect: CreatorProspect }) {
  const [state, formAction, pending] = useActionState(updateCreatorProspectAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="prospectId" value={prospect.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-ink">
            Creator name
          </label>
          <input id="displayName" name="displayName" type="text" required defaultValue={prospect.displayName} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contactName" className="text-sm font-medium text-ink">
            Contact / real name
          </label>
          <input id="contactName" name="contactName" type="text" defaultValue={prospect.contactName} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contactEmail" className="text-sm font-medium text-ink">
            Contact email
          </label>
          <input id="contactEmail" name="contactEmail" type="email" defaultValue={prospect.contactEmail} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="platform" className="text-sm font-medium text-ink">
            Primary platform
          </label>
          <input id="platform" name="platform" type="text" placeholder="e.g. YouTube" defaultValue={prospect.platform} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="profileUrl" className="text-sm font-medium text-ink">
            Profile / channel URL
          </label>
          <input id="profileUrl" name="profileUrl" type="url" placeholder="https://..." defaultValue={prospect.profileUrl} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="niche" className="text-sm font-medium text-ink">
            Niche
          </label>
          <input id="niche" name="niche" type="text" defaultValue={prospect.niche} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="followersApprox" className="text-sm font-medium text-ink">
            Approx. followers
          </label>
          <input
            id="followersApprox"
            name="followersApprox"
            type="text"
            placeholder="e.g. 42K"
            defaultValue={prospect.followersApprox}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="notes" className="text-sm font-medium text-ink">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} defaultValue={prospect.notes} className={INPUT_CLASS} />
        </div>
      </div>

      {state.error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

      <button type="submit" disabled={pending} className={buttonVariants({ variant: "primary", className: "self-start" })}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
