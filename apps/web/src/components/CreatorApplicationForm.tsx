"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { submitCreatorApplicationAction } from "@/lib/creatorApplicationActions";
import type { CreatorApplicationState } from "@/lib/creatorApplicationActions";

const initialState: CreatorApplicationState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

export function CreatorApplicationForm() {
  const [state, formAction, pending] = useActionState(submitCreatorApplicationAction, initialState);

  if (state.submitted) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-paper-alt px-5 py-6 text-center">
        <p className="text-base font-semibold text-ink">Application sent</p>
        <p className="text-sm text-ink-soft">Thanks for your interest — Kyle reviews every application personally and will follow up by email.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium text-ink">
          Name
        </label>
        <input id="name" name="name" type="text" required autoComplete="name" maxLength={200} className={INPUT_CLASS} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={INPUT_CLASS} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="platform" className="text-sm font-medium text-ink">
          Primary platform
        </label>
        <input id="platform" name="platform" type="text" placeholder="e.g. YouTube, Instagram, TikTok" className={INPUT_CLASS} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="profileUrl" className="text-sm font-medium text-ink">
          Channel / profile URL
        </label>
        <input id="profileUrl" name="profileUrl" type="url" placeholder="https://..." maxLength={500} className={INPUT_CLASS} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="message" className="text-sm font-medium text-ink">
          Tell us about your audience (optional)
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={5000}
          placeholder="Who do you reach, and what do you create?"
          className={INPUT_CLASS}
        />
      </div>

      {/* Honeypot — hidden from sighted and screen-reader users. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonVariants({ variant: "primary", className: "w-full sm:w-auto" })}>
        {pending ? "Sending…" : "Apply to the program"}
      </button>
    </form>
  );
}
