"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { linkCreatorBusinessAction, type CreatorFormState } from "@/lib/creatorAdminActions";

const initialState: CreatorFormState = {};

/** Linking a creator to their own TallyVis business — the prerequisite for complimentary access (see docs/decisions/0040's "Free creator access" section). Kyle finds the business id on that business's own `/admin/businesses/[id]` page. */
export function LinkBusinessForm({ creatorId }: { creatorId: string }) {
  const [state, formAction, pending] = useActionState(linkCreatorBusinessAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="creatorId" value={creatorId} />
      <label htmlFor="businessId" className="text-sm font-medium text-ink">
        Link to a TallyVis business (optional)
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="businessId"
          name="businessId"
          type="text"
          placeholder="business_... (from its admin page)"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
        <button type="submit" disabled={pending} className={buttonVariants({ variant: "outline" })}>
          {pending ? "Linking…" : "Link"}
        </button>
      </div>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
