"use client";

import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isPropertyComplete, type PropertyType, type StoriesInput } from "@/lib/estimator/types";
import { StepFooter } from "@/components/StepFooter";
import { OptionButton } from "@/components/OptionButton";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "single-family", label: "Single-family home" },
  { value: "townhouse", label: "Townhouse" },
  { value: "other", label: "Other" },
];

const STORY_OPTIONS: { value: StoriesInput; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3+" },
];

export default function PropertyStepPage() {
  const { input, updateProperty } = useEstimator();
  const canContinue = isPropertyComplete(input.property);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Step 1 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Tell us about your property
        </h1>
        <p className="text-ink-soft">Just the basics — this helps us understand the job.</p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-ink">Property type</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PROPERTY_TYPES.map((option) => (
            <OptionButton
              key={option.value}
              selected={input.property.propertyType === option.value}
              onClick={() => updateProperty({ propertyType: option.value })}
            >
              {option.label}
            </OptionButton>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-ink">How many stories?</legend>
        <div className="grid grid-cols-3 gap-2 sm:w-64">
          {STORY_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              selected={input.property.stories === option.value}
              onClick={() => updateProperty({ stories: option.value })}
            >
              {option.label}
            </OptionButton>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="address" className="text-sm font-medium text-ink">
          Property address <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="address"
          type="text"
          value={input.property.address}
          onChange={(e) => updateProperty({ address: e.target.value })}
          placeholder="123 Main St, Springfield"
          className="rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
      </div>

      <StepFooter
        continueHref={canContinue ? "/estimate/photos" : undefined}
        continueDisabled={!canContinue}
      />
      {!canContinue ? (
        <p className="-mt-6 text-xs text-ink-faint">
          Select a property type and story count to continue.
        </p>
      ) : null}
    </div>
  );
}
