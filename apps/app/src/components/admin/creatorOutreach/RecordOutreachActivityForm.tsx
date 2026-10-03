"use client";

import { useState } from "react";
import { useActionState } from "react";
import { CREATOR_OUTREACH_STATUSES, CREATOR_OUTREACH_STATUS_LABELS, CREATOR_OUTREACH_FOLLOW_UP_QUICK_OPTIONS } from "@tallyvis/config";
import { buttonVariants, cn } from "@tallyvis/ui";
import { recordOutreachActivityAction, type RecordActivityFormState } from "@/lib/creatorOutreachActions";

const initialState: RecordActivityFormState = {};

function quickFollowUpValue(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The fast "record what happened, then Save & Next Creator" form — the
 * creator-outreach equivalent of the Sales Call Tracker's end-call
 * outcome form, minus any timer/start-call concept (an email exchange
 * has no "in progress" state — see
 * docs/decisions/0042-creator-outreach-tracker.md's "Outreach
 * lifecycle" section).
 */
export function RecordOutreachActivityForm({ prospectId }: { prospectId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [followUpAt, setFollowUpAt] = useState("");
  const [state, formAction, pending] = useActionState(recordOutreachActivityAction, initialState);

  const followUpEmphasized = status === "follow_up" || status === "interested";

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-2xl border border-line bg-paper p-6">
      <input type="hidden" name="prospectId" value={prospectId} />

      <div>
        <p className="text-sm font-medium text-ink">Status</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CREATOR_OUTREACH_STATUSES.filter((value) => value !== "converted").map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                status === value ? "border-accent-strong bg-accent-strong text-accent-foreground" : "border-line bg-paper text-ink hover:border-ink",
              )}
            >
              {CREATOR_OUTREACH_STATUS_LABELS[value]}
            </button>
          ))}
        </div>
        <input type="hidden" name="status" value={status ?? ""} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium text-ink">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="One sentence is fine."
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
      </div>

      <div className={cn("flex flex-col gap-2 rounded-lg p-3", followUpEmphasized ? "border border-accent bg-accent-soft" : "")}>
        <p className="text-sm font-medium text-ink">Follow-up {followUpEmphasized ? "(recommended)" : "(optional)"}</p>
        <div className="flex flex-wrap gap-2">
          {CREATOR_OUTREACH_FOLLOW_UP_QUICK_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFollowUpAt(quickFollowUpValue(option.days))}
              className={buttonVariants({ variant: "outline", className: "px-3 py-1.5 text-xs" })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          name="followUpAt"
          value={followUpAt}
          onChange={(e) => setFollowUpAt(e.target.value)}
          className="w-fit rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
      </div>

      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}

      <button type="submit" disabled={pending || !status} className={buttonVariants({ variant: "primary", className: "self-start" })}>
        {pending ? "Saving…" : "Save & Next Creator"}
      </button>
    </form>
  );
}
