import type { ConfidenceLevel, WindowCleaningCharacteristics } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "@tallyvis/pricing";
import { windowCleaningDefaultPricingRules } from "@tallyvis/config";

export interface PricingBreakdownProps {
  characteristics: WindowCleaningCharacteristics;
  confidence: ConfidenceLevel;
}

/**
 * Renders a REAL estimate: this calls packages/pricing's actual pricing
 * function with the demo characteristics — the only "fake" input here is
 * DEMO_CHARACTERISTICS (standing in for future computer-vision output). The
 * math itself is exactly what a real business's pricing engine would produce.
 */
export function PricingBreakdown({ characteristics, confidence }: PricingBreakdownProps) {
  const estimate = calculateWindowCleaningEstimate(
    characteristics,
    windowCleaningDefaultPricingRules,
    confidence,
  );

  return (
    <div className="rounded-2xl border border-accent bg-accent-soft p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Estimate
        </p>
        <span className="rounded-full bg-paper px-2.5 py-1 text-[10px] font-medium capitalize text-ink-soft">
          {confidence} confidence
        </span>
      </div>

      <ul className="mb-4 flex flex-col gap-1.5 text-sm text-ink-soft">
        {estimate.lineItems.map((item) => (
          <li key={item.label} className="flex justify-between gap-4">
            <span>{item.label}</span>
            <span className="font-mono">${item.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-accent/30 pt-4">
        <span className="text-sm font-medium text-ink">Total</span>
        <span className="text-3xl font-semibold tracking-tight text-ink">
          ${estimate.total.toFixed(2)}
        </span>
      </div>

      <p className="mt-3 text-xs text-ink-soft">
        This total is generated the same way a real estimate would be: job characteristics run
        through the business&rsquo;s own pricing rules, not decided by AI. Medium confidence means a
        business would review this before it&rsquo;s sent.
      </p>
    </div>
  );
}
