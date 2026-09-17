import { useState } from "react";
import type { AccessibilityLevel, WindowCleaningPricingRules } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "@tallyvis/pricing";
import { buttonVariants } from "@tallyvis/ui";

const ACCESSIBILITY_OPTIONS: AccessibilityLevel[] = ["easy", "moderate", "difficult"];

/**
 * Calls the exact same pricing engine the customer estimator and quote
 * detail page use — there is one pricing implementation in this product,
 * this is just a convenient way to exercise it against hypothetical inputs.
 */
export function PricingPreviewTool({ rules }: { rules: WindowCleaningPricingRules }) {
  const [windowCount, setWindowCount] = useState(27);
  const [stories, setStories] = useState(2);
  const [screens, setScreens] = useState(12);
  const [accessibility, setAccessibility] = useState<AccessibilityLevel>("moderate");
  const [result, setResult] = useState<number | null>(null);

  function runPreview() {
    const estimate = calculateWindowCleaningEstimate(
      {
        vertical: "window-cleaning",
        windowCount,
        windowType: "double-hung",
        paneCount: 0,
        stories,
        screens,
        tracks: screens,
        accessibility,
        condition: "fair",
        hardWaterStaining: false,
        interiorCleaning: false,
        estimatedLaborHours: 0,
      },
      rules,
      "high",
    );
    setResult(estimate.total);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper-alt p-6">
      <div>
        <p className="text-sm font-semibold text-ink">Test your pricing</p>
        <p className="text-xs text-ink-soft">
          See how a hypothetical job would price under the rules above.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Windows</span>
          <input
            type="number"
            min={0}
            value={windowCount}
            onChange={(e) => setWindowCount(Number(e.target.value) || 0)}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Stories</span>
          <input
            type="number"
            min={1}
            value={stories}
            onChange={(e) => setStories(Math.max(1, Number(e.target.value) || 1))}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Screens</span>
          <input
            type="number"
            min={0}
            value={screens}
            onChange={(e) => setScreens(Number(e.target.value) || 0)}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Access</span>
          <select
            value={accessibility}
            onChange={(e) => setAccessibility(e.target.value as AccessibilityLevel)}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          >
            {ACCESSIBILITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option[0]!.toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={runPreview}
          className={buttonVariants({ variant: "primary" })}
        >
          Calculate
        </button>
        {result !== null ? (
          <p className="text-lg font-semibold text-ink">
            Estimated price: <span className="font-mono">${result.toFixed(2)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
