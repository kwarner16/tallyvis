"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete } from "@/lib/estimator/types";
import { blobUrlToDataUrl } from "@/lib/imageEncoding";
import { analyzePublicPropertyAction, isUsingMockAiProviderAction } from "@/lib/publicActions";

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
  const { input, setAnalysis, setAnalysisError, analysisError } = useEstimator();
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
        analyzePublicPropertyAction({
          images: dataUrls.map((url) => ({ url })),
          property: {
            address: input.property.address || undefined,
            stories: input.property.stories ?? undefined,
          },
        }),
    );

    Promise.all([analyze, minDisplay])
      .then(([result]) => {
        if (cancelled) return;
        clearInterval(stageTimer);
        setAnalysis(result);
        router.push("/estimate/result");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clearInterval(stageTimer);
        // The Server Action already resolves the failure's category to a
        // specific, safe message (Phase 12 — see
        // docs/decisions/0014-ai-real-world-refinement.md); fall back to a
        // generic one only if something unexpected reached here.
        setAnalysisError(
          err instanceof Error ? err.message : "Something went wrong while analyzing your photos.",
        );
      });

    return () => {
      cancelled = true;
      clearInterval(stageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  if (analysisError) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-xl font-semibold text-accent-strong"
        >
          !
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Analysis failed</h1>
          <p className="mt-2 max-w-xs text-sm text-ink-soft">{analysisError}</p>
        </div>
        <div className="flex gap-3">
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
