"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete } from "@/lib/estimator/types";
import { blobUrlToDataUrl } from "@/lib/imageEncoding";
import { analyzePublicPropertyAction, isUsingMockAiProviderAction } from "@/lib/publicActions";
import { ESTIMATOR_NOT_CONFIGURED_MESSAGE, NO_BUSINESS_CONFIGURED_MESSAGE } from "@/lib/publicBusinessErrors";

/** These mean the business itself can't be resolved — retrying or falling back to manual entry hits the exact same wall, since both need the same business lookup to succeed. Only the business owner can fix this. */
const UNRECOVERABLE_MESSAGES: string[] = [ESTIMATOR_NOT_CONFIGURED_MESSAGE, NO_BUSINESS_CONFIGURED_MESSAGE];

const STAGES = [
  "Analyzing your property...",
  "Reviewing photos...",
  "Identifying windows...",
  "Understanding access...",
  "Calculating job characteristics...",
  "Preparing your estimate...",
];

const STAGE_INTERVAL_MS = 450;
const MIN_DISPLAY_MS = STAGE_INTERVAL_MS * (STAGES.length - 1) + 300;

export default function AnalyzingStepPage() {
  const { input, embedId, setAnalysis, setAnalysisError, analysisError } = useEstimator();
  const router = useRouter();
  const [stageIndex, setStageIndex] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [isMockProvider, setIsMockProvider] = useState(true);

  useEffect(() => {
    isUsingMockAiProviderAction().then(setIsMockProvider);
  }, []);

  useEffect(() => {
    if (!isPropertyComplete(input.property) || input.photos.length === 0) {
      router.replace("/estimate/property");
    }
    // Only need to check this once per mount — not on every input change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setAnalysisError(null);
        setStageIndex(0);
      }
    });

    const stageTimer = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);

    const minDisplay = new Promise<void>((resolve) => setTimeout(resolve, MIN_DISPLAY_MS));

    // Photos live only as blob: URLs in this tab (see EstimatorContext) —
    // meaningless to the server, so each is re-read into a data: URI right
    // here, on demand, and sent to the Server Action that actually calls
    // the AI provider. Nothing is uploaded or stored anywhere new; see
    // docs/decisions/0013-ai-analysis-foundation.md.
    const analyze = Promise.all(input.photos.map((photo) => blobUrlToDataUrl(photo.previewUrl))).then(
      (dataUrls) =>
        analyzePublicPropertyAction(
          {
            images: dataUrls.map((url) => ({ url })),
            property: {
              address: input.property.address || undefined,
              stories: input.property.stories ?? undefined,
            },
          },
          embedId ?? undefined,
        ),
    );

    Promise.all([analyze, minDisplay])
      .then(([result]) => {
        if (cancelled) return;
        clearInterval(stageTimer);
        if (result.ok) {
          setAnalysis(result.data.analysis, result.data.observation);
          router.push("/estimate/result");
          return;
        }
        // The Server Action already resolves the failure's category to a
        // specific, safe message (Phase 12 — see
        // docs/decisions/0014-ai-real-world-refinement.md) and returns it as
        // data rather than throwing — a thrown error's real message is
        // stripped in a production build (see actionResult.ts).
        setAnalysisError(result.message);
      })
      .catch((err: unknown) => {
        // Only reachable from blobUrlToDataUrl's own client-side conversion
        // (the Server Action itself no longer throws) — a corrupt/expired
        // blob: URL, not a server-side failure.
        if (cancelled) return;
        clearInterval(stageTimer);
        setAnalysisError(err instanceof Error ? err.message : "Something went wrong while preparing your photos.");
      });

    return () => {
      cancelled = true;
      clearInterval(stageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  if (analysisError) {
    const unrecoverable = UNRECOVERABLE_MESSAGES.includes(analysisError);
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-xl font-semibold text-accent-strong"
        >
          !
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {unrecoverable ? "This estimator isn't available" : "Analysis failed"}
          </h1>
          <p className="mt-2 max-w-xs text-sm text-ink-soft">{analysisError}</p>
        </div>
        {unrecoverable ? null : (
          <>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setRetryToken((t) => t + 1)}
                className={buttonVariants({ variant: "primary" })}
              >
                Try again
              </button>
              <Link href="/estimate/photos" className={buttonVariants({ variant: "outline" })}>
                Back to photos
              </Link>
            </div>
            {/*
              Phase 13 (see docs/decisions/0015-job-outcome-tracking.md) — an
              AI failure must never be a dead end for the customer. This is the
              real manual-entry path Phase 12's "continue manually" language
              promised but the public estimator didn't yet have. Only shown
              when the business itself resolved fine and it's the AI call
              specifically that failed — manual entry needs the same business
              resolution the retry button does, so it's no more recoverable
              than "Try again" when that's what failed.
            */}
            <Link href="/estimate/manual" className="text-sm font-medium text-accent-strong hover:text-accent">
              Continue without AI — enter details manually
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 py-12 text-center">
      <div className="relative grid w-full max-w-sm grid-cols-3 gap-2 overflow-hidden rounded-2xl border border-line bg-paper-alt p-2">
        {input.photos.slice(0, 3).map((photo) => (
          <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ))}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 h-1 rounded bg-accent opacity-80"
          style={{ animation: "scan 1.8s ease-in-out infinite" }}
        />
      </div>

      <div
        role="status"
        className="flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink-soft"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        {STAGES[stageIndex]}
      </div>

      <p className="text-xs text-ink-faint">
        {isMockProvider
          ? "This analysis is simulated for this prototype — not a live computer-vision result."
          : "Your photos are analyzed securely on our servers."}
      </p>
    </div>
  );
}
