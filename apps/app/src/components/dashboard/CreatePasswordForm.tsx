"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@tallyvis/ui";
import { setPasswordAction } from "@/lib/businessActions";

/**
 * Google-only-account password UX fix (2026-09): shown in Settings ONLY
 * when `!user.hasPassword` — the counterpart to the "Change password"
 * link shown when a password already exists. Deliberately never asks for
 * a CURRENT password (there isn't one to ask for); once this succeeds,
 * `user.hasPassword` becomes true and this whole form is replaced by the
 * normal "Change password" link on the next render (see
 * SettingsPageClient's parent, settings/page.tsx, which re-derives
 * `user.hasPassword` from the database on every load).
 */
export function CreatePasswordForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = password === confirmPassword;
  const canSubmit = password.length >= 8 && passwordsMatch;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await setPasswordAction(password);
    if (result.ok) {
      // The action already revalidated /dashboard/settings server-side;
      // refresh() re-runs this Server Component so `user.hasPassword`
      // comes back true and this form is replaced by the normal "Change
      // password" link, without a full page reload.
      router.refresh();
    } else {
      setError(result.message);
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-accent-strong hover:underline"
        >
          Create password
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 sm:max-w-xs">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        autoFocus
        className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm password"
        autoComplete="new-password"
        className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      />
      {password.length > 0 && password.length < 8 ? (
        <p className="text-xs text-accent-strong">Password must be at least 8 characters.</p>
      ) : null}
      {confirmPassword.length > 0 && !passwordsMatch ? <p className="text-xs text-accent-strong">Passwords don&rsquo;t match.</p> : null}
      {error ? <p className="text-sm text-accent-strong">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className={buttonVariants({ variant: "primary", className: "px-4 py-1.5 text-sm" })}
        >
          {saving ? "Saving…" : "Create password"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-faint hover:text-ink-soft">
          Cancel
        </button>
      </div>
    </div>
  );
}
