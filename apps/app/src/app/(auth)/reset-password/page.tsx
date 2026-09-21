"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { resetPasswordAction, type AuthActionState } from "@/lib/authActions";

const initialState: AuthActionState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  if (!token) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Invalid link</h1>
        <p className="text-sm text-ink-soft">
          This password reset link is missing its token. Request a new one below.
        </p>
        <Link href="/forgot-password" className={buttonVariants({ variant: "primary" })}>
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Choose a new password</h1>
        <p className="text-sm text-ink-soft">This link can only be used once.</p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-ink">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
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
          {pending ? "Saving…" : "Reset password"}
        </button>
      </form>
    </div>
  );
}

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md). `useSearchParams`
 * requires a Suspense boundary; wrapping right here keeps the rest of the
 * (auth) route group's static rendering unaffected.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
