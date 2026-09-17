import { Button } from "@tallyvis/ui";
import { windowCleaningDefaultPricingRules } from "@tallyvis/config";
import { calculateWindowCleaningEstimate } from "@tallyvis/pricing";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";

// A hard-coded example — real characteristics come from services/ai in a later phase.
const exampleCharacteristics: WindowCleaningCharacteristics = {
  vertical: "window-cleaning",
  windowCount: 27,
  windowType: "double-hung",
  paneCount: 0,
  stories: 2,
  screens: 12,
  tracks: 12,
  accessibility: "moderate",
  condition: "fair",
  hardWaterStaining: false,
  estimatedLaborHours: 2.4,
};

export default function Home() {
  const estimate = calculateWindowCleaningEstimate(
    exampleCharacteristics,
    windowCleaningDefaultPricingRules,
    "medium",
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-24 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-orange-600">
          Phase 1 — foundation
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl dark:text-zinc-50">
          Your job. Seen differently.
        </h1>
        <p className="max-w-lg text-lg text-zinc-600 dark:text-zinc-400">
          This is a scaffolding placeholder, not the marketing site. The real design (Phase 2) will
          replace this page. What&rsquo;s below is a live proof that the pricing engine, shared
          types, and UI package are wired together correctly.
        </p>

        <div className="w-full rounded-lg border border-zinc-200 bg-white p-6 text-left dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Example estimate (mock characteristics — no AI involved yet)
          </p>
          <ul className="mb-4 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            {estimate.lineItems.map((item) => (
              <li key={item.label} className="flex justify-between gap-4">
                <span>{item.label}</span>
                <span>${item.amount.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-semibold text-zinc-950 dark:border-zinc-800 dark:text-zinc-50">
            <span>Total ({estimate.confidence} confidence)</span>
            <span>${estimate.total.toFixed(2)}</span>
          </div>
        </div>

        <Button className="bg-orange-600 text-white hover:bg-orange-700">
          See What Tallyvis Sees (Phase 3)
        </Button>
      </main>
    </div>
  );
}
