import type { AccessibilityLevel, WindowCleaningPricingRules } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";

const PRICE_FIELDS: { key: keyof WindowCleaningPricingRules; label: string }[] = [
  { key: "basePrice", label: "Base price" },
  { key: "pricePerWindow", label: "Per window" },
  { key: "secondStorySurcharge", label: "Second-story surcharge" },
  { key: "screenCleaningPrice", label: "Screen cleaning" },
  { key: "trackCleaningPrice", label: "Track cleaning" },
  { key: "hardWaterTreatmentPrice", label: "Hard-water treatment" },
  { key: "interiorCleaningPrice", label: "Interior cleaning" },
  { key: "travelFee", label: "Travel / equipment fee" },
  { key: "minimumJobPrice", label: "Minimum job" },
];

export interface PricingRulesFormProps {
  rules: WindowCleaningPricingRules;
  onChange: (rules: WindowCleaningPricingRules) => void;
  onSave: () => void;
  dirty: boolean;
}

export function PricingRulesForm({ rules, onChange, onSave, dirty }: PricingRulesFormProps) {
  function setPrice(key: keyof WindowCleaningPricingRules, value: number) {
    onChange({ ...rules, [key]: Math.max(0, value) });
  }

  function setMultiplier(level: AccessibilityLevel, value: number) {
    onChange({
      ...rules,
      difficultyMultipliers: { ...rules.difficultyMultipliers, [level]: Math.max(0, value) },
    });
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-line bg-paper p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRICE_FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">{field.label}</span>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-paper px-3 py-2 focus-within:ring-2 focus-within:ring-accent-strong">
              <span className="text-sm text-ink-faint">$</span>
              <input
                type="number"
                min={0}
                value={rules[field.key] as number}
                onChange={(e) => setPrice(field.key, Number(e.target.value) || 0)}
                className="w-full bg-transparent text-sm text-ink focus-visible:outline-none"
              />
            </div>
          </label>
        ))}
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-ink">Difficulty multipliers</p>
        <div className="grid grid-cols-3 gap-4">
          {(["easy", "moderate", "difficult"] as const).map((level) => (
            <label key={level} className="flex flex-col gap-1">
              <span className="text-xs font-medium capitalize text-ink-soft">{level}</span>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-paper px-3 py-2 focus-within:ring-2 focus-within:ring-accent-strong">
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  value={rules.difficultyMultipliers[level]}
                  onChange={(e) => setMultiplier(level, Number(e.target.value) || 0)}
                  className="w-full bg-transparent text-sm text-ink focus-visible:outline-none"
                />
                <span className="text-sm text-ink-faint">&times;</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty}
          className={buttonVariants({ variant: "primary" })}
        >
          Save pricing rules
        </button>
        {dirty ? <span className="text-xs text-ink-faint">Unsaved changes</span> : null}
      </div>
    </div>
  );
}
