"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { windowCleaningEstimatorConfig } from "@/lib/estimator/industry-config";
import type { TriState } from "@/lib/estimator/types";
import { OptionButton } from "@/components/OptionButton";
import { StepFooter } from "@/components/StepFooter";

const TRI_STATE_OPTIONS: { value: TriState; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

export default function DetailsStepPage() {
  const { input, updateServices, setNotes } = useEstimator();
  const router = useRouter();
  const { serviceQuestions } = windowCleaningEstimatorConfig;

  useEffect(() => {
    if (input.photos.length === 0) {
      router.replace("/estimate/photos");
    }
  }, [input.photos.length, router]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Step 3 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          A few more details
        </h1>
        <p className="text-ink-soft">
          This helps us tailor the estimate to what you actually want done.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {serviceQuestions.map((question) => (
          <fieldset key={question.key} className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">{question.label}</legend>
            {question.helpText ? (
              <p className="text-xs text-ink-faint">{question.helpText}</p>
            ) : null}
            <div className="flex gap-2">
              {(
                [
                  { value: true, label: "Yes" },
                  { value: false, label: "No" },
                ] as const
              ).map((option) => (
                <OptionButton
                  key={String(option.value)}
                  selected={input.services[question.key] === option.value}
                  onClick={() => updateServices({ [question.key]: option.value })}
                >
                  {option.label}
                </OptionButton>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">Any hard-water staining?</legend>
          <div className="flex gap-2">
            {TRI_STATE_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                selected={input.services.hardWaterTreatment === option.value}
                onClick={() => updateServices({ hardWaterTreatment: option.value })}
              >
                {option.label}
              </OptionButton>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="notes" className="text-sm font-medium text-ink">
          Anything else we should know?{" "}
          <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <textarea
          id="notes"
          rows={3}
          value={input.notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. some windows on the back of the house are hard to access"
          className="resize-none rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
      </div>

      <StepFooter backHref="/estimate/photos" continueHref="/estimate/review" />
    </div>
  );
}
