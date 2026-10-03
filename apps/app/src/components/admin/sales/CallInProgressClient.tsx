"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { SalesCallDetail } from "@tallyvis/api";
import { SALES_CALL_OUTCOMES, SALES_CALL_OUTCOME_LABELS, SALES_OBJECTIONS, SALES_OBJECTION_LABELS, FOLLOW_UP_QUICK_OPTIONS } from "@tallyvis/config";
import { buttonVariants, cn } from "@tallyvis/ui";
import { endCallAction, type EndCallFormState } from "@/lib/salesAdminActions";

const initialState: EndCallFormState = {};

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Local-time `datetime-local` input value for N days from now, defaulting to 9am — a reasonable business-hours default for the quick-pick buttons. */
function quickFollowUpValue(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The entire Start Call -> End Call -> Save & Next Call screen (see
 * docs/decisions/0041-sales-call-tracker.md's "Call lifecycle" section).
 * The timer always recomputes elapsed time from `detail.call.startedAt`
 * (persisted server-side when the call started) rather than any local
 * "time I clicked Start" state, so a page refresh mid-call never loses
 * or resets it. "End Call" is a pure client-side reveal of the outcome
 * form — nothing is written to the database until "Save & Next Call"
 * submits everything (outcome/notes/objections/follow-up) together in
 * one action.
 */
export function CallInProgressClient({ detail }: { detail: SalesCallDetail }) {
  const { call, prospect, priorCalls } = detail;
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - Date.parse(call.startedAt)) / 1000)));
  const [ended, setEnded] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [objections, setObjections] = useState<Set<string>>(new Set());
  const [followUpAt, setFollowUpAt] = useState("");
  const [state, formAction, pending] = useActionState(endCallAction, initialState);

  useEffect(() => {
    if (ended) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(call.startedAt)) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [call.startedAt, ended]);

  function toggleObjection(key: string) {
    setObjections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const followUpEmphasized = outcome === "follow_up" || outcome === "interested";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/sales" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
        ← Sales
      </Link>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{ended ? "Call ended" : "Calling"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{prospect.businessName}</h1>
        <dl className="mt-3 flex flex-col gap-1 text-sm text-ink-soft">
          {prospect.contactName ? <p>{prospect.contactName}</p> : null}
          <p className="font-mono text-base text-ink">{prospect.phone}</p>
          {prospect.website ? <p>{prospect.website}</p> : null}
          <p>{[prospect.city, prospect.state].filter(Boolean).join(", ") || null}</p>
        </dl>

        <p className="mt-4 font-mono text-4xl font-semibold tabular-nums text-ink">{formatElapsed(elapsedSeconds)}</p>

        {!ended ? (
          <button type="button" onClick={() => setEnded(true)} className={buttonVariants({ variant: "destructive", className: "mt-4" })}>
            End Call
          </button>
        ) : null}
      </div>

      {priorCalls.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Previous calls</h2>
          <div className="flex flex-col gap-2">
            {priorCalls.map((prior) => (
              <div key={prior.id} className="rounded-lg border border-line bg-paper-alt p-3 text-sm">
                <p className="font-medium text-ink">
                  {formatDateTime(prior.startedAt)} · {prior.outcome ? SALES_CALL_OUTCOME_LABELS[prior.outcome as keyof typeof SALES_CALL_OUTCOME_LABELS] ?? prior.outcome : "No outcome recorded"}
                </p>
                {prior.notes ? <p className="mt-1 text-ink-soft">{prior.notes}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ended ? (
        <form action={formAction} className="flex flex-col gap-5 rounded-2xl border border-line bg-paper p-6">
          <input type="hidden" name="callId" value={call.id} />

          <div>
            <p className="text-sm font-medium text-ink">Outcome</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SALES_CALL_OUTCOMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOutcome(value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    outcome === value ? "border-accent-strong bg-accent-strong text-accent-foreground" : "border-line bg-paper text-ink hover:border-ink",
                  )}
                >
                  {SALES_CALL_OUTCOME_LABELS[value]}
                </button>
              ))}
            </div>
            <input type="hidden" name="outcome" value={outcome ?? ""} />
          </div>

          <div>
            <p className="text-sm font-medium text-ink">Objections (optional)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SALES_OBJECTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleObjection(value)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    objections.has(value) ? "border-accent-strong bg-accent-strong/10 text-accent-strong" : "border-line bg-paper text-ink-soft hover:border-ink",
                  )}
                >
                  {SALES_OBJECTION_LABELS[value]}
                </button>
              ))}
            </div>
            {Array.from(objections).map((value) => (
              <input key={value} type="hidden" name="objections" value={value} />
            ))}
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
              {FOLLOW_UP_QUICK_OPTIONS.map((option) => (
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

          <button
            type="submit"
            disabled={pending || !outcome}
            className={buttonVariants({ variant: "primary", className: "self-start" })}
          >
            {pending ? "Saving…" : "Save & Next Call"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
