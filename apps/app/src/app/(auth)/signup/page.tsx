"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { isPlanId } from "@tallyvis/config";
import { buttonVariants } from "@tallyvis/ui";
import { signUpAction, type AuthActionState } from "@/lib/authActions";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { GoogleErrorBanner } from "@/components/auth/GoogleErrorBanner";

const initialState: AuthActionState = {};

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * Preserves a plan chosen on the marketing site's pricing section
 * (`?plan=growth`) through signup — carried as a hidden field so
 * `signUpAction` can remember it for the dashboard's onboarding prompt
 * (Phase 14 — see docs/decisions/0016-onboarding-billing-embed.md). An
 * unrecognized/missing value is simply omitted, never trusted beyond "a
 * plan to preselect," and account creation itself never depends on it.
 */
function SignUpForm() {
  const rawPlan = useSearchParams().get("plan");
  const intendedPlan = rawPlan && isPlanId(rawPlan) ? rawPlan : "";
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
        <p className="text-sm text-ink-soft">
          Sets up your business&rsquo;s Tallyvis workspace, starting with a default rate card you can
          edit any time.
        </p>
      </div>

      <GoogleErrorBanner />

      <GoogleSignInButton />

      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <div className="h-px flex-1 bg-line" />
        or
        <div className="h-px flex-1 bg-line" />
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="plan" value={intendedPlan} />
        <div className="flex flex-col gap-2">
          <label htmlFor="businessName" className="text-sm font-medium text-ink">
            Business name
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            required
            placeholder="Sparkle Window Cleaning"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="ownerEmail" className="text-sm font-medium text-ink">
            Your email
          </label>
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            required
            autoComplete="email"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Password
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
          <span className="text-xs text-ink-faint">At least 8 characters.</span>
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
          {pending ? "Creating your workspace…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-ink-faint">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent-strong hover:text-accent">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}
