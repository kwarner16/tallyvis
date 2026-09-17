"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete } from "@/lib/estimator/types";
import { windowCleaningEstimatorConfig } from "@/lib/estimator/industry-config";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StepFooter } from "@/components/StepFooter";

export default function PhotosStepPage() {
  const { input } = useEstimator();
  const router = useRouter();
  const { minPhotos, photoIntro, photoGuidance } = windowCleaningEstimatorConfig;
  const canContinue = input.photos.length >= minPhotos;

  useEffect(() => {
    if (!isPropertyComplete(input.property)) {
      router.replace("/estimate/property");
    }
  }, [input.property, router]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Step 2 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{photoIntro}</h1>
        <p className="text-ink-soft">
          Take a few photos of the outside of your home so Tallyvis can understand the job.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm text-ink-soft">
        {photoGuidance.map((tip) => (
          <li key={tip} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            {tip}
          </li>
        ))}
      </ul>

      <PhotoUpload />

      <StepFooter
        backHref="/estimate/property"
        continueHref={canContinue ? "/estimate/details" : undefined}
        continueDisabled={!canContinue}
      />
    </div>
  );
}
