"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { logInAction, type AuthActionState } from "@/lib/authActions";

const initialState: AuthActionState = {};

function ResetSuccessBanner() {
  const justReset = useSearchParams().get("reset") === "success";
  if (!justReset) return null;
  return (
    <p className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent-strong">
      Your password has been reset. Log in with your new password.
    </p>
  );
}

const INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(logInAction, initialState);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Log in</h1>
        <p className="text-sm text-ink-soft">Access your Tallyvis dashboard.</p>
      </div>

      <Suspense fallback={null}>
        <ResetSuccessBanner />
      </Suspense>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-medium text-accent-strong hover:text-accent">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
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
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="text-center text-sm text-ink-faint">
        New to Tallyvis?{" "}
        <Link href="/signup" className="font-medium text-accent-strong hover:text-accent">
          Create an account
        </Link>
      </p>
    </div>
  );
}
