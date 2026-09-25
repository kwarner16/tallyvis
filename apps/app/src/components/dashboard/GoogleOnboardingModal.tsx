"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@tallyvis/ui";
import { completeOnboardingAction } from "@/lib/businessActions";
import { logOutAction } from "@/lib/authActions";

/**
 * Google-signup onboarding gap fix (2026-09). Shown by dashboard/layout.tsx
 * INSTEAD OF the real dashboard for a brand-new Google signup
 * (`business.needsOnboarding`) — never for a password signup, which
 * already collects a real business name upfront, and never again for a
 * Google user who has already completed this once (`needsOnboarding` is
 * cleared on success and never re-set).
 *
 * The password field is optional and clearly framed as such — a
 * Google-authenticated account works perfectly well without one; this
 * only offers the convenience of also being able to log in with
 * email/password later, entirely the account owner's choice.
 */
export function GoogleOnboardingModal({ initialBusinessName }: { initialBusinessName: string }) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantsPassword = password.length > 0 || confirmPassword.length > 0;
  const passwordsMatch = password === confirmPassword;
  const canSubmit = businessName.trim().length > 0 && (!wantsPassword || (password.length >= 8 && passwordsMatch));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await completeOnboardingAction({
      businessName: businessName.trim(),
      password: wantsPassword ? password : undefined,
    });
    if (result.ok) {
      // needsOnboarding is now false server-side, and the action already
      // revalidated /dashboard — this layout is force-dynamic, so
      // push() re-runs dashboard/layout.tsx's check against fresh data
      // rather than replaying a stale cached RSC payload.
      router.push("/dashboard");
    } else {
      setError(result.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-alt px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Finish setting up your account</h1>
        <p className="mt-1 text-sm text-ink-soft">
          You signed up with Google — just a couple more details before you get started.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">
              Business name <span className="text-accent-strong">*</span>
            </span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoFocus
              className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </label>

          <div className="flex flex-col gap-1 border-t border-line pt-4">
            <span className="text-sm font-medium text-ink">
              Create a password for email login <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <p className="text-xs text-ink-faint">
              You can always sign in with Google alone — this just adds the option to also use your
              email and a password. You can set this up later from Settings instead.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
            {wantsPassword && password.length > 0 && password.length < 8 ? (
              <p className="mt-1 text-xs text-accent-strong">Password must be at least 8 characters.</p>
            ) : null}
            {wantsPassword && confirmPassword.length > 0 && !passwordsMatch ? (
              <p className="mt-1 text-xs text-accent-strong">Passwords don&rsquo;t match.</p>
            ) : null}
          </div>

          {error ? <p className="text-sm text-accent-strong">{error}</p> : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className={buttonVariants({ variant: "primary" })}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button
            type="button"
            onClick={() => logOutAction()}
            className="self-center text-xs text-ink-faint hover:text-ink-soft hover:underline"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
