"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import type { Creator } from "@tallyvis/api";
import { CREATOR_PROGRAM_POLICY } from "@tallyvis/config";
import { createCreatorAction, updateCreatorAction, type CreatorFormState } from "@/lib/creatorAdminActions";

const initialState: CreatorFormState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * Shared by the "add creator" form (`/admin/creators`, no `creator` prop
 * — slug is editable, since none exists yet) and the "edit creator" form
 * (`/admin/creators/[id]`, `creator` provided — slug is read-only there:
 * see `services/creators.ts`'s own comment on why a creator's referral
 * code is immutable once created).
 */
export function CreatorForm({ creator }: { creator?: Creator }) {
  const action = creator ? updateCreatorAction : createCreatorAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {creator ? <input type="hidden" name="creatorId" value={creator.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink">
            Name
          </label>
          <input id="name" name="name" type="text" required defaultValue={creator?.name} className={INPUT_CLASS} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input id="email" name="email" type="email" required defaultValue={creator?.email} className={INPUT_CLASS} />
        </div>

        {creator ? null : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slug" className="text-sm font-medium text-ink">
              Referral code
            </label>
            <input
              id="slug"
              name="slug"
              type="text"
              required
              placeholder="e.g. ben"
              pattern="[a-z0-9][a-z0-9-]{1,31}"
              className={INPUT_CLASS}
            />
            <p className="text-xs text-ink-faint">
              Lowercase letters, numbers, hyphens only — becomes tallyvis.com/r/&lt;code&gt;. Cannot be changed later.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="platform" className="text-sm font-medium text-ink">
            Primary platform
          </label>
          <input
            id="platform"
            name="platform"
            type="text"
            placeholder="e.g. YouTube, Instagram, TikTok"
            defaultValue={creator?.platform}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="profileUrl" className="text-sm font-medium text-ink">
            Profile / channel URL
          </label>
          <input
            id="profileUrl"
            name="profileUrl"
            type="url"
            placeholder="https://..."
            defaultValue={creator?.profileUrl}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="commissionRateBps" className="text-sm font-medium text-ink">
            Commission rate (basis points)
          </label>
          <input
            id="commissionRateBps"
            name="commissionRateBps"
            type="number"
            min={0}
            max={10000}
            step={1}
            defaultValue={creator?.commissionRateBps ?? CREATOR_PROGRAM_POLICY.defaultCommissionRateBps}
            className={INPUT_CLASS}
          />
          <p className="text-xs text-ink-faint">2000 = 20%. Applied to future commissions only — past ones keep their original rate.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="commissionDurationMonths" className="text-sm font-medium text-ink">
            Commission duration (months)
          </label>
          <input
            id="commissionDurationMonths"
            name="commissionDurationMonths"
            type="number"
            min={1}
            max={120}
            step={1}
            defaultValue={creator?.commissionDurationMonths ?? CREATOR_PROGRAM_POLICY.defaultCommissionDurationMonths}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="notes" className="text-sm font-medium text-ink">
            Internal notes
          </label>
          <textarea id="notes" name="notes" rows={3} defaultValue={creator?.notes} className={INPUT_CLASS} />
        </div>
      </div>

      {state.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonVariants({ variant: "primary", className: "self-start" })}>
        {pending ? "Saving…" : creator ? "Save changes" : "Add creator"}
      </button>
    </form>
  );
}
