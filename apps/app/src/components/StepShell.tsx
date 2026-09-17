"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@tallyvis/ui";

const STEPS = [
  { key: "property", label: "Property", href: "/estimate/property" },
  { key: "photos", label: "Photos", href: "/estimate/photos" },
  { key: "details", label: "Details", href: "/estimate/details" },
  { key: "review", label: "Review", href: "/estimate/review" },
  { key: "result", label: "Estimate", href: "/estimate/result" },
];

export interface StepShellProps {
  children: ReactNode;
}

/** Shared chrome for every /estimate/* step: wordmark + progress indicator. */
export function StepShell({ children }: StepShellProps) {
  const pathname = usePathname();
  const currentIndex = STEPS.findIndex((step) => pathname?.startsWith(step.href));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8 sm:px-6 sm:py-14">
      <header className="mb-8 flex flex-col gap-6 sm:mb-10">
        <Link href="/estimate" className="flex items-center gap-2 text-base font-semibold text-ink">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Tallyvis
        </Link>

        {currentIndex >= 0 ? (
          <ol aria-label="Estimate progress" className="flex items-center">
            {STEPS.map((step, i) => (
              <li key={step.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center gap-2">
                  <span
                    aria-current={i === currentIndex ? "step" : undefined}
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                      i < currentIndex && "border-accent bg-accent-soft text-accent-strong",
                      i === currentIndex && "border-accent-strong bg-accent-strong text-paper",
                      i > currentIndex && "border-line text-ink-faint",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden text-xs font-medium sm:inline",
                      i === currentIndex ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {i < STEPS.length - 1 ? (
                  <span aria-hidden="true" className="mx-2 h-px flex-1 bg-line" />
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
