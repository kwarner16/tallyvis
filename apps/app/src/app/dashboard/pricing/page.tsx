"use client";

import { useEffect, useState } from "react";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { validatePricingRules } from "@tallyvis/pricing";
import { getPricingConfiguration, savePricingRules } from "@/lib/quotes/store";
import { PricingRulesForm } from "@/components/dashboard/PricingRulesForm";
import { PricingPreviewTool } from "@/components/dashboard/PricingPreviewTool";

function formatEffectiveDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PricingPage() {
  const [configuration, setConfiguration] = useState<PricingConfiguration | null>(null);
  const [savedRules, setSavedRules] = useState<WindowCleaningPricingRules | null>(null);
  const [justSavedVersion, setJustSavedVersion] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const current = getPricingConfiguration();
      setConfiguration(current);
      setSavedRules(current.rules);
    });
  }, []);

  if (!configuration || !savedRules) return null;

  const rules = configuration.rules;
  const dirty = JSON.stringify(rules) !== JSON.stringify(savedRules);
  const validation = validatePricingRules(rules);

  function setRules(nextRules: WindowCleaningPricingRules) {
    setConfiguration((current) => (current ? { ...current, rules: nextRules } : current));
    setJustSavedVersion(null);
    setSaveError(null);
  }

  function handleSave() {
    if (!validation.valid) return;
    try {
      const saved = savePricingRules(rules);
      setSavedRules(saved.rules);
      setConfiguration(saved);
      setJustSavedVersion(saved.version);
      setSaveError(null);
      setTimeout(() => setJustSavedVersion(null), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save pricing rules.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Your pricing rules
        </h1>
        <p className="text-ink-soft">
          Tallyvis uses these rules to turn job characteristics into estimates.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-paper-alt px-4 py-3 text-sm text-ink-soft">
        <span className="font-medium text-ink">What Tallyvis does:</span> identifies what the job
        involves. <span className="font-medium text-ink">What you control:</span> what that work is
        worth to your business. Tallyvis applies your rules consistently — it never decides pricing
        on its own.
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-line bg-paper px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Current configuration
          </p>
          <p className="mt-1 text-sm font-medium text-ink">
            Version {configuration.version}
            <span className="font-normal text-ink-faint">
              {" "}
              &middot; active since {formatEffectiveDate(configuration.effectiveAt)}
            </span>
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
          Active
        </span>
      </div>

      {justSavedVersion !== null ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          Saved as version {justSavedVersion}. New estimates — including the customer estimator —
          use this configuration; quotes already created keep the pricing they were calculated
          with.
        </p>
      ) : null}

      {saveError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      <PricingRulesForm
        rules={rules}
        onChange={setRules}
        onSave={handleSave}
        dirty={dirty}
        errors={validation.errors}
      />

      <PricingPreviewTool configuration={configuration} />
    </div>
  );
}
