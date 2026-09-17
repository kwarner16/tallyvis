"use client";

import { useEffect, useRef, useState } from "react";
import { Container, PropertyPhoto, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { Reveal } from "./Reveal";
import { AnalysisStatus } from "./analysis-demo/AnalysisStatus";
import { JobCharacteristicsPanel } from "./analysis-demo/JobCharacteristicsPanel";
import { PricingBreakdown } from "./analysis-demo/PricingBreakdown";
import { PropertyComparison } from "./analysis-demo/PropertyComparison";
import {
  ANALYSIS_STEPS,
  DEMO_CHARACTERISTICS,
  DEMO_CONFIDENCE,
  LAST_STEP_INDEX,
} from "./analysis-demo/data";
import type { AnalysisStage, CharacteristicKey } from "./analysis-demo/types";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SeeWhatTallyvisSees() {
  const [stage, setStage] = useState<AnalysisStage>("idle");
  const [stepIndex, setStepIndex] = useState(-1);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  useEffect(() => clearTimers, []);

  function runFullSequence() {
    clearTimers();
    setStepIndex(-1);
    setStage("analyzing");

    ANALYSIS_STEPS.forEach((step, i) => {
      const timer = setTimeout(() => {
        setStepIndex(i);
        if (i === LAST_STEP_INDEX - 1) setStage("analyzed");
        if (i === LAST_STEP_INDEX) setStage("estimate-ready");
      }, step.atMs);
      timersRef.current.push(timer);
    });
  }

  function jumpToEnd() {
    clearTimers();
    setStepIndex(LAST_STEP_INDEX);
    setStage("estimate-ready");
  }

  function handleAnalyze() {
    if (prefersReducedMotion()) {
      jumpToEnd();
    } else {
      runFullSequence();
    }
  }

  const revealedDetectionIds = new Set(
    ANALYSIS_STEPS.slice(0, stepIndex + 1).flatMap((s) => s.revealDetectionIds ?? []),
  );
  const revealedCharacteristics = new Set<CharacteristicKey>(
    ANALYSIS_STEPS.slice(0, stepIndex + 1).flatMap((s) => s.revealCharacteristics ?? []),
  );
  const revealStoryMarker = ANALYSIS_STEPS.slice(0, stepIndex + 1).some((s) => s.revealStoryMarker);
  const currentStatus = stepIndex >= 0 ? (ANALYSIS_STEPS[stepIndex]?.status ?? null) : null;
  const isRunning = stage === "analyzing";
  const isDone = stage === "estimate-ready";

  return (
    <section id="see-what-tallyvis-sees" className="border-y border-line bg-paper-alt py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="The core product"
            heading="See what Tallyvis sees."
            description="Ordinary photos become structured job information."
          />
        </Reveal>

        <Reveal delayMs={100} className="grid gap-8 lg:grid-cols-5 lg:gap-10">
          <div className="flex flex-col gap-4 lg:col-span-3">
            {stage === "idle" ? (
              <div className="relative overflow-hidden rounded-2xl border border-line">
                <PropertyPhoto className="h-full w-full" />
                <div className="absolute inset-0 flex items-center justify-center bg-ink/10">
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    className={buttonVariants({ variant: "primary" })}
                  >
                    Analyze property
                  </button>
                </div>
              </div>
            ) : (
              <PropertyComparison
                revealedDetectionIds={revealedDetectionIds}
                revealStoryMarker={revealStoryMarker}
                running={isRunning}
              />
            )}

            <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
              <AnalysisStatus status={currentStatus} stage={stage} />
              {isRunning ? (
                <button
                  type="button"
                  onClick={jumpToEnd}
                  className="text-sm font-medium text-ink-faint underline-offset-4 hover:text-ink hover:underline"
                >
                  Skip
                </button>
              ) : null}
              {isDone ? (
                <button
                  type="button"
                  onClick={handleAnalyze}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Analyze again
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-2">
            <JobCharacteristicsPanel
              characteristics={DEMO_CHARACTERISTICS}
              revealed={revealedCharacteristics}
            />

            {isDone ? (
              <>
                <div
                  className="flex items-center gap-2 text-xs font-medium text-ink-faint"
                  style={{ animation: "fade-in 0.35s ease-out" }}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="h-3.5 w-3.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4v16m0 0l-5-5m5 5l5-5"
                    />
                  </svg>
                  Business&rsquo;s pricing rules applied
                </div>
                <PricingBreakdown
                  characteristics={DEMO_CHARACTERISTICS}
                  confidence={DEMO_CONFIDENCE}
                />
              </>
            ) : null}
          </div>
        </Reveal>

        <Reveal delayMs={160}>
          <p className="text-xs text-ink-faint">
            Demo data for illustration &mdash; not live computer-vision output. See &ldquo;Tallyvis
            knows when it doesn&rsquo;t know&rdquo; further down this page for how confidence works
            in the real product.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
