"use client";

import { useEffect, useState } from "react";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { getPricingConfiguration, savePricingRules } from "@/lib/quotes/store";
import { PricingRulesForm } from "@/components/dashboard/PricingRulesForm";
import { PricingPreviewTool } from "@/components/dashboard/PricingPreviewTool";

export default function PricingPage() {
  const [configuration, setConfiguration] = useState<PricingConfiguration | null>(null);
  const [savedRules, setSavedRules] = useState<WindowCleaningPricingRules | null>(null);
  const [justSaved, setJustSaved] = useState(false);

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

  function setRules(nextRules: WindowCleaningPricingRules) {
    setConfiguration((current) => (current ? { ...current, rules: nextRules } : current));
  }

  function handleSave() {
    savePricingRules(rules);
    setSavedRules(rules);
    setConfiguration(getPricingConfiguration());
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
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

      {justSaved ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          Pricing rules saved. New estimates — including the customer estimator — will use these
          values.
        </p>
      ) : null}

      <PricingRulesForm rules={rules} onChange={setRules} onSave={handleSave} dirty={dirty} />

      <PricingPreviewTool configuration={configuration} />
    </div>
  );
}
