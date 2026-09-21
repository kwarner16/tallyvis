"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@tallyvis/ui";

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

/**
 * Phase 14 — a lightweight, dismissible-for-this-visit onboarding
 * checklist (see docs/decisions/0016-onboarding-billing-embed.md). Every
 * item's `done` state is computed server-side from real data (a
 * subscription row exists, a pricing configuration was actually edited,
 * branding was set, the embed was actually detected, a quote actually
 * exists) — never a client-side flag a business could get out of sync
 * with reality. Purely a guide: dismissing it hides it for this browser
 * session only (sessionStorage), and it never blocks any dashboard page.
 */
export function OnboardingChecklist({ items }: { items: OnboardingChecklistItem[] }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("tallyvis-onboarding-dismissed") === "1";
    } catch {
      return false;
    }
  });

  if (dismissed || items.every((item) => item.done)) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem("tallyvis-onboarding-dismissed", "1");
    } catch {
      // Not fatal — it'll just show again next session.
    }
  }

  const doneCount = items.filter((item) => item.done).length;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          Welcome to Tallyvis — {doneCount} of {items.length} done
        </p>
        <button type="button" onClick={dismiss} className="text-xs text-ink-faint hover:text-ink-soft">
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-paper-alt",
                item.done ? "text-ink-faint line-through" : "text-ink",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",
                  item.done ? "border-accent-strong bg-accent-strong text-paper" : "border-line",
                )}
              >
                {item.done ? "✓" : ""}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
