"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@tallyvis/ui";
import { deriveEstimatorTheme } from "@tallyvis/config";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { getPublicBusinessAction } from "@/lib/publicActions";
import { MARKETING_URL } from "@/lib/urls";

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

/**
 * Reports this page's content height to a parent window via postMessage
 * whenever it changes — harmless no-op at the top level (no listener
 * cares), and the exact signal `public/embed.js`'s iframe listens for to
 * auto-size itself (Phase 14 — see
 * docs/decisions/0016-onboarding-billing-embed.md). Scoped to a
 * `tallyvis-embed` source tag so it can never be mistaken for an
 * arbitrary/unrelated postMessage.
 */
function useReportHeightToParent(): React.RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const post = () => {
      window.parent.postMessage({ source: "tallyvis-embed", type: "resize", height: node.scrollHeight }, "*");
    };

    const observer = new ResizeObserver(post);
    observer.observe(node);
    post();
    return () => observer.disconnect();
  }, []);

  return rootRef;
}

/**
 * Business-controlled estimator branding (docs/decisions/0016, extended by
 * the branding work in this pass) — fetched once per mount/embed and
 * applied as CSS custom-property overrides on the whole step tree below, so
 * every step (not just /estimate/result, which used to be the only one)
 * reflects the resolved business's brand color. Best-effort: a failure here
 * (e.g. a stale/invalid embedId) is left for the step itself to surface its
 * own real error — this hook silently keeps the default Tallyvis theme
 * rather than duplicating that error handling.
 *
 * Deliberately does NOT call `getPublicBusinessAction` at all when
 * `embedId` is falsy — a production bug (confirmed 2026-09-24) had the
 * direct, unembedded `/estimate` wizard picking up an arbitrary business's
 * brand color anyway, because `getPublicBusinessAction(undefined)` falls
 * back to `getDefaultPublicBusiness` (the stated Phase 9 single-business
 * simplification — see CLAUDE.md), and that fallback's business's color
 * was being applied as if it were real embed branding. Tenant branding
 * must only ever apply to an ACTUAL embed (`embedId` genuinely set); the
 * standalone estimator always gets Tallyvis's own default theme.
 */
function useEstimatorBrandTheme(embedId: string | null): CSSProperties | undefined {
  const [brandColor, setBrandColor] = useState<string | null>(null);

  useEffect(() => {
    if (!embedId) return;
    let cancelled = false;
    getPublicBusinessAction(embedId).then((result) => {
      // A failed resolution is left to whichever step actually needs the
      // business (analyze, create-quote, ...) to show a real, actionable
      // error — this hook only ever affects cosmetic theming.
      if (!cancelled && result.ok) setBrandColor(result.data.brandColor ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [embedId]);

  // Never apply a fetched brand color once `embedId` is gone, even if a
  // fetch from a previous embed is still resolving/resolved in state —
  // `embedId` (not `brandColor`) is the single source of truth for
  // whether ANY tenant branding should apply at all.
  const theme = embedId ? deriveEstimatorTheme(brandColor) : null;
  return theme ? (theme as CSSProperties) : undefined;
}

/** Shared chrome for every /estimate/* step: wordmark + progress indicator. */
export function StepShell({ children }: StepShellProps) {
  const pathname = usePathname();
  const { embedId } = useEstimator();
  const currentIndex = STEPS.findIndex((step) => pathname?.startsWith(step.href));
  const rootRef = useReportHeightToParent();
  const brandStyle = useEstimatorBrandTheme(embedId);

  return (
    <div
      ref={rootRef}
      style={brandStyle}
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col px-5 py-8 sm:px-6 sm:py-14",
        // Full-viewport height standalone; natural content height inside an
        // embed iframe, so `embed.js`'s auto-resize actually shrinks to fit.
        embedId ? "min-h-0" : "min-h-screen",
      )}
    >
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
                      i === currentIndex && "border-accent-strong bg-accent-strong text-accent-foreground",
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

      <PoweredByTallyvis embedded={Boolean(embedId)} />
    </div>
  );
}

/**
 * Part 14 UX pass: on a business's own embedded estimator (`embedId` set —
 * see `public/embed.js`), this stays deliberately subtle — the primary
 * identity here is the embedding business's, not Tallyvis's (see
 * `useEstimatorBrandTheme` above) — and opens in a new tab rather than
 * navigating so clicking it can never carry a customer away from the
 * business's own website inside their embedded iframe. On the direct,
 * unembedded `/estimate/*` wizard (the marketing site's bare fallback —
 * see `getDefaultPublicBusiness`), it's a normal, clearer link back to the
 * marketing site, since there's no third-party page to protect here.
 */
function PoweredByTallyvis({ embedded }: { embedded: boolean }) {
  return (
    <div className={cn("pt-6 text-center", embedded ? "text-[11px] text-ink-faint/70" : "text-xs text-ink-faint")}>
      <a
        href={MARKETING_URL}
        target={embedded ? "_blank" : undefined}
        rel={embedded ? "noopener noreferrer" : undefined}
        className="hover:text-ink-soft"
      >
        Powered by Tallyvis
      </a>
    </div>
  );
}
