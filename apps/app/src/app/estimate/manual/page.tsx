"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@tallyvis/ui";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete } from "@/lib/estimator/types";
import { defaultWindowCleaningCharacteristics } from "@/lib/defaultCharacteristics";
import { JobCharacteristicsFields } from "@/components/dashboard/JobCharacteristicsFields";

/**
 * Phase 13 (see docs/decisions/0015-job-outcome-tracking.md) — the real
 * manual-entry fallback for when AI photo analysis fails, reached from
 * `/estimate/analyzing`'s error state. Deliberately not a redesign of the
 * estimator: it reuses the same `JobCharacteristicsFields` the dashboard's
 * "New quote" flow already uses, and feeds its result into `analysis` the
 * exact same way a successful AI analysis would — `/estimate/result`
 * doesn't know or care whether `analysis` came from AI or was entered by
 * hand, and still recomputes the estimate server-side either way through
 * the same `calculateEstimate()` pricing engine. No AI observation exists
 * for this path (`aiObservation` stays `null`), which is itself
 * meaningful data: "not determinable" is preserved as exactly that.
 */
export default function ManualEntryStepPage() {
  const { input, setAnalysis } = useEstimator();
  const router = useRouter();
  const [characteristics, setCharacteristics] = useState<WindowCleaningCharacteristics>(() =>
    defaultWindowCleaningCharacteristics({ stories: input.property.stories ?? 1 }),
  );

  useEffect(() => {
    if (!isPropertyComplete(input.property)) {
      router.replace("/estimate/property");
    }
    // Only need to check this once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleContinue() {
    setAnalysis(
      {
        characteristics,
        metadata: {
          confidence: "low",
          notes: ["Entered manually — AI photo analysis was not used for this estimate."],
        },
      },
      null,
    );
    router.push("/estimate/result");
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Tell us about the windows
        </h1>
        <p className="text-ink-soft">
          Automatic photo analysis wasn&rsquo;t available, so enter what you can and we&rsquo;ll estimate
          from that. You can leave anything you&rsquo;re not sure about at its default.
        </p>
      </div>

      <JobCharacteristicsFields value={characteristics} onChange={setCharacteristics} />

      <div className="flex items-center justify-between gap-4 border-t border-line pt-6">
        <button
          type="button"
          onClick={() => router.push("/estimate/photos")}
          className={buttonVariants({ variant: "outline" })}
        >
          Back
        </button>
        <button type="button" onClick={handleContinue} className={buttonVariants({ variant: "primary" })}>
          Get my estimate
        </button>
      </div>
    </div>
  );
}
