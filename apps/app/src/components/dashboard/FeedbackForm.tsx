"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { buttonVariants, cn } from "@tallyvis/ui";
import { submitFeedbackAction, type FeedbackActionState } from "@/lib/feedbackActions";

const initialState: FeedbackActionState = {};

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "suggestion", label: "Suggestion" },
  { value: "feedback", label: "Feedback" },
];

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * Production hardening (see docs/decisions/0039-embed-logo-signup-
 * notifications-and-feedback.md) — intentionally simple: type, message,
 * an optional "contact me" checkbox, submit. `sourcePath` (the page the
 * business was on) is captured here via `usePathname()` and sent as a
 * plain hidden field — never anything from browser storage, cookies, or
 * page contents.
 */
export function FeedbackForm() {
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState(submitFeedbackAction, initialState);

  if (state.success) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-6 text-center">
        <p className="text-base font-semibold text-ink">Thanks — we got it.</p>
        <p className="text-sm text-ink-soft">Kyle reads every submission personally.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cn(buttonVariants({ variant: "outline" }), "self-center")}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-2xl border border-line bg-paper p-6">
      <input type="hidden" name="sourcePath" value={pathname ?? ""} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Type</legend>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:border-accent has-[:checked]:border-accent-strong has-[:checked]:bg-accent-soft has-[:checked]:text-accent-strong"
            >
              <input
                type="radio"
                name="type"
                value={option.value}
                defaultChecked={option.value === "feedback"}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="message" className="text-sm font-medium text-ink">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          maxLength={4000}
          rows={6}
          placeholder="What's going on?"
          className={cn(INPUT_CLASS, "resize-none")}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="contactMe" className="h-4 w-4 rounded border-line" />
        Contact me about this
      </label>

      {state.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonVariants({ variant: "primary" })}>
        {pending ? "Sending…" : "Submit"}
      </button>
    </form>
  );
}
