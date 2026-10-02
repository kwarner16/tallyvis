"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { recordCreatorActivityAction, type CreatorFormState } from "@/lib/creatorAdminActions";

const initialState: CreatorFormState = {};

/**
 * Lightweight, manual record of a creator's most recent qualifying
 * content — see docs/decisions/0040's V1.1 addendum "Active Creator
 * definition" section. TallyVis does not automatically verify content
 * publication; Kyle fills this in himself after actually checking.
 */
export function RecordActivityForm({ creatorId }: { creatorId: string }) {
  const [state, formAction, pending] = useActionState(recordCreatorActivityAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="creatorId" value={creatorId} />
      <div className="flex flex-wrap gap-2">
        <input
          name="contentAt"
          type="date"
          required
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
        <input
          name="contentUrl"
          type="url"
          placeholder="https://... (link to the content)"
          required
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
      </div>
      <input
        name="note"
        type="text"
        placeholder="Note (optional — e.g. which platform, what it covered)"
        className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      />
      <button type="submit" disabled={pending} className={buttonVariants({ variant: "outline", className: "self-start" })}>
        {pending ? "Saving…" : "Record qualifying content"}
      </button>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
