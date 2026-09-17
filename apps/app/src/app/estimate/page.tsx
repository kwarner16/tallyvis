"use client";

import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete } from "@/lib/estimator/types";

export default function EstimateWelcomePage() {
  const { input } = useEstimator();
  const hasDraft = isPropertyComplete(input.property);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
        Free instant estimate
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Get your estimate
      </h1>
      <p className="max-w-md text-lg leading-relaxed text-ink-soft">
        Answer a few quick questions and show us your property. We&rsquo;ll turn that into a real
        estimate in a couple of minutes.
      </p>

      <ul className="flex flex-col gap-3 text-sm text-ink-soft">
        {["Tell us about your property", "Add a few photos", "Get your estimate"].map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs font-medium text-ink-faint">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Link href="/estimate/property" className={buttonVariants({ variant: "primary" })}>
          {hasDraft ? "Continue your estimate" : "Get started"}
        </Link>
      </div>

      <p className="text-xs text-ink-faint">
        This is a prototype experience. Analysis is currently simulated, and no request is sent to a
        real business until you confirm at the end.
      </p>
    </div>
  );
}
