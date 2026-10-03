"use client";

import { useActionState, useState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import type { CreatorProspect } from "@tallyvis/api";
import { convertToCreatorAction, type ConvertFormState } from "@/lib/creatorOutreachActions";

const initialState: ConvertFormState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * The one safe, explicit prospect -> real Founding Creator conversion
 * (see docs/decisions/0042-creator-outreach-tracker.md's "Prospect ->
 * creator conversion" section). Reuses `createCreatorAdmin` entirely
 * unchanged — this form only collects the few fields that function
 * actually requires (a slug, a real email) that a prospect record may
 * not yet have. The new creator is created in its normal default
 * ("prospect") status; activation, complimentary access, and business
 * linking all still happen afterward through the existing, unchanged
 * `/admin/creators/[id]` workflow.
 */
export function ConvertToCreatorForm({ prospect }: { prospect: CreatorProspect }) {
  const [state, formAction, pending] = useActionState(convertToCreatorAction, initialState);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="prospectId" value={prospect.id} />
      <p className="text-sm text-ink-soft">
        This creates a real Founding Creator record for{" "}
        <span className="font-medium text-ink">{prospect.displayName}</span> and links it to this prospect. It does{" "}
        <span className="font-medium text-ink">not</span> activate them, grant complimentary access, or do anything else — that
        still happens on the creator&rsquo;s own admin page afterward.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="slug" className="text-sm font-medium text-ink">
            Referral code
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            placeholder="e.g. steveo"
            pattern="[a-z0-9][a-z0-9-]{1,31}"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink">
            Name
          </label>
          <input id="name" name="name" type="text" defaultValue={prospect.displayName} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input id="email" name="email" type="email" required defaultValue={prospect.contactEmail} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="platform" className="text-sm font-medium text-ink">
            Primary platform
          </label>
          <input id="platform" name="platform" type="text" defaultValue={prospect.platform} className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profileUrl" className="text-sm font-medium text-ink">
            Profile URL
          </label>
          <input id="profileUrl" name="profileUrl" type="url" defaultValue={prospect.profileUrl} className={INPUT_CLASS} />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line"
        />
        I&rsquo;ve confirmed this creator wants to join and I&rsquo;m ready to create their Founding Creator record.
      </label>

      {state.error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

      <button type="submit" disabled={pending || !confirmed} className={buttonVariants({ variant: "primary", className: "self-start" })}>
        {pending ? "Converting…" : "Convert to Founding Creator"}
      </button>
    </form>
  );
}
