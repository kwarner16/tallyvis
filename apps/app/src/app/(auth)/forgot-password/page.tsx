"use client";

import { useActionState } from "react";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { requestPasswordResetAction } from "@/lib/authActions";
import type { AuthActionState } from "@/lib/authActions";

const initialState: AuthActionState & { submitted?: boolean } = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md). The confirmation
 * shown after submitting is identical whether or not the email belongs to
 * a real account — this page never learns which, by design.
 */
export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.submitted) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Check your email</h1>
        <p className="text-sm text-ink-soft">
          If an account exists for that email address, we&rsquo;ve sent instructions to reset your
          password. The link expires in 1 hour.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent-strong hover:text-accent">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Forgot password</h1>
        <p className="text-sm text-ink-soft">
          Enter the email you signed up with and we&rsquo;ll send you a link to reset your password.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={INPUT_CLASS} />
        </div>

        {state.error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className={buttonVariants({ variant: "primary", className: "w-full" })}
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="text-center text-sm text-ink-faint">
        <Link href="/login" className="font-medium text-accent-strong hover:text-accent">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
