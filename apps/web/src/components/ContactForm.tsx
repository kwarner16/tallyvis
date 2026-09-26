"use client";

import { useActionState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { submitContactAction } from "@/lib/contactActions";
import type { ContactActionState } from "@/lib/contactActions";

const initialState: ContactActionState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

export function ContactForm() {
  const [state, formAction, pending] = useActionState(submitContactAction, initialState);

  if (state.submitted) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-lg border border-line bg-paper-alt px-5 py-6 text-center"
      >
        <p className="text-base font-semibold text-ink">Message sent</p>
        <p className="text-sm text-ink-soft">Thanks for reaching out — we&rsquo;ll get back to you soon.</p>
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
        <label htmlFor="message" className="text-sm font-medium text-ink">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          placeholder="What can we help with?"
          className={INPUT_CLASS}
        />
      </div>

      {/* Honeypot — hidden from sighted and screen-reader users, real visitors never fill this in. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={buttonVariants({ variant: "primary", className: "w-full sm:w-auto" })}
      >
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
