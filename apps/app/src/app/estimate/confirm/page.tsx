"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@tallyvis/ui";
import type { AccessibilityLevel, ConfidenceLevel, WindowCleaningCharacteristics } from "@tallyvis/types";
import type { ObservedValue } from "@tallyvis/api";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { StepFooter } from "@/components/StepFooter";

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — the customer confirmation step: the primary human-in-the-loop, not the
 * business owner. Shown after a successful AI analysis (never for manual
 * entry, which has nothing AI-derived to confirm — see
 * `/estimate/analyzing`'s and `/estimate/manual`'s routing). Deliberately
 * limited to the fields that actually affect price (`packages/pricing`'s
 * `windowCleaning.ts` — windowCount, stories, accessibility, screens,
 * tracks, hardWaterStaining) — `condition` and `windowType` are excluded
 * on purpose: neither has any pricing effect today, so asking a customer
 * to confirm them would cost time toward the "10-30 seconds" goal for
 * nothing the pricing engine would ever use.
 *
 * No developer concepts reach the customer (no "confidence: 0.72", no
 * "ObservedValue", no field-level JSON) — only natural-language labels and
 * tap targets. The AI's per-field status still drives HOW much attention
 * each field gets (see `tierFor`), just never shown as such.
 */

type FieldTier = "detected" | "confirm" | "required";

function tierFor<T>(field: ObservedValue<T> | undefined): FieldTier {
  if (!field || field.status === "unknown") return "required";
  if (field.status === "uncertain") return "confirm";
  return field.confidence === "high" ? "detected" : "confirm";
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-lg font-medium text-ink hover:bg-paper-alt"
      >
        −
      </button>
      <span className="w-10 text-center text-lg font-semibold text-ink">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-lg font-medium text-ink hover:bg-paper-alt"
      >
        +
      </button>
    </div>
  );
}

function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            value === opt.value
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-line bg-paper text-ink-soft hover:border-ink-faint",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TierHint({ tier }: { tier: FieldTier }) {
  if (tier === "detected") return null;
  return (
    <span
      className={cn(
        "text-xs font-semibold",
        tier === "required" ? "text-accent-strong" : "text-ink-soft",
      )}
    >
      {tier === "required" ? "Needs your input" : "Please confirm"}
    </span>
  );
}

function FieldRow({
  label,
  tier,
  hint,
  children,
}: {
  label: string;
  tier: FieldTier;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">{label}</p>
        <TierHint tier={tier} />
      </div>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
      {children}
    </div>
  );
}

const STORIES_OPTIONS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3+" },
];

const ACCESSIBILITY_OPTIONS: { value: AccessibilityLevel; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "difficult", label: "Difficult" },
];

type AmountAnswer = "none" | "some" | "most" | "not_sure";
const AMOUNT_OPTIONS: { value: AmountAnswer; label: string }[] = [
  { value: "none", label: "None" },
  { value: "some", label: "Some" },
  { value: "most", label: "Most/all" },
  { value: "not_sure", label: "Not sure" },
];

function amountFromCount(count: number, windowCount: number): AmountAnswer {
  if (count <= 0) return "none";
  if (windowCount > 0 && count >= windowCount * 0.7) return "most";
  return "some";
}

function countFromAmount(amount: AmountAnswer, windowCount: number, fallback: number): number {
  if (amount === "none") return 0;
  if (amount === "most") return windowCount;
  if (amount === "some") return Math.max(1, Math.round(windowCount * 0.35));
  return fallback;
}

type YesNoAnswer = "yes" | "no" | "not_sure";
const YES_NO_OPTIONS: { value: YesNoAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

export default function ConfirmStepPage() {
  const { analysis, aiObservation, evidenceMessages, input, setAnalysis, setConfirmed } = useEstimator();
  const router = useRouter();

  useEffect(() => {
    if (!analysis) {
      router.replace("/estimate/property");
      return;
    }
    // Nothing AI-derived to confirm (manual entry) — go straight to the
    // result page, exactly like it already did before this step existed.
    if (!aiObservation) {
      setConfirmed(true);
      router.replace("/estimate/result");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [characteristics, setCharacteristics] = useState<WindowCleaningCharacteristics | null>(
    analysis?.characteristics ?? null,
  );
  const [screensAmount, setScreensAmount] = useState<AmountAnswer | null>(null);
  const [tracksAmount, setTracksAmount] = useState<AmountAnswer | null>(null);
  const [hardWaterAnswer, setHardWaterAnswer] = useState<YesNoAnswer | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [anyUnsure, setAnyUnsure] = useState(false);

  const windowCountTier = tierFor(aiObservation?.windowCount);
  const storiesTier = tierFor(aiObservation?.stories);
  const accessibilityTier = tierFor(aiObservation?.accessibility);

  const requiredFields = useMemo(
    () =>
      ([
        ["windowCount", windowCountTier],
        ["stories", storiesTier],
        ["accessibility", accessibilityTier],
      ] as const)
        .filter(([, tier]) => tier === "required")
        .map(([key]) => key),
    [windowCountTier, storiesTier, accessibilityTier],
  );
  const canContinue = requiredFields.every((key) => answered.has(key));

  function markAnswered(key: string) {
    setAnswered((prev) => new Set(prev).add(key));
  }

  if (!analysis || !aiObservation || !characteristics) return null;

  const evidenceInsufficient = aiObservation.evidence.overallEvidence === "insufficient";
  const windowCountHint =
    evidenceInsufficient && aiObservation.windowCount.status !== "unknown"
      ? "Tallyvis could clearly see this many windows, but the photos may not show the whole property — please make sure this is the full count."
      : undefined;

  function handleContinue() {
    if (!characteristics || !analysis) return;

    // Confirming a field raises trust in that VALUE, but never fixes a
    // genuine photo-coverage gap — the confidence handed to the pricing
    // engine stays capped when the underlying evidence was insufficient,
    // even after the customer confirms a number, so a low-evidence quote
    // still surfaces for business review (see
    // determineInitialQuoteStatus in services/api).
    let confidence: ConfidenceLevel = "high";
    if (anyUnsure || evidenceInsufficient) confidence = "medium";

    const notes = (analysis.metadata.notes ?? []).filter((n) => !n.toLowerCase().includes("please review"));

    setAnalysis(
      {
        characteristics,
        metadata: { confidence, notes: notes.length > 0 ? notes : undefined },
      },
      aiObservation,
      evidenceMessages,
    );
    setConfirmed(true);
    router.push("/estimate/result");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Quick check
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Here&rsquo;s what Tallyvis found
        </h1>
        <p className="text-ink-soft">Confirm or adjust anything below — it only takes a moment.</p>
      </div>

      <div className="rounded-2xl border border-line bg-paper px-6">
        <FieldRow label="Windows" tier={windowCountTier} hint={windowCountHint}>
          <Stepper
            value={characteristics.windowCount}
            min={0}
            max={300}
            onChange={(v) => {
              setCharacteristics((c) => (c ? { ...c, windowCount: v } : c));
              markAnswered("windowCount");
            }}
          />
        </FieldRow>

        <FieldRow label="Stories" tier={storiesTier}>
          <PillGroup
            options={STORIES_OPTIONS}
            value={(characteristics.stories >= 3 ? 3 : characteristics.stories) as 1 | 2 | 3}
            onChange={(v) => {
              setCharacteristics((c) => (c ? { ...c, stories: v } : c));
              markAnswered("stories");
            }}
          />
        </FieldRow>

        <FieldRow label="Access" tier={accessibilityTier} hint="How easy is it to reach the windows?">
          <PillGroup
            options={ACCESSIBILITY_OPTIONS}
            value={characteristics.accessibility}
            onChange={(v) => {
              setCharacteristics((c) => (c ? { ...c, accessibility: v } : c));
              markAnswered("accessibility");
            }}
          />
        </FieldRow>

        {input.services.screens ? (
          <FieldRow label="Screens" tier={tierFor(aiObservation.screens)}>
            <PillGroup
              options={AMOUNT_OPTIONS}
              value={screensAmount ?? amountFromCount(characteristics.screens, characteristics.windowCount)}
              onChange={(v) => {
                setScreensAmount(v);
                if (v === "not_sure") setAnyUnsure(true);
                setCharacteristics((c) =>
                  c ? { ...c, screens: countFromAmount(v, c.windowCount, c.screens) } : c,
                );
              }}
            />
          </FieldRow>
        ) : null}

        {input.services.tracks ? (
          <FieldRow label="Tracks" tier={tierFor(aiObservation.tracks)}>
            <PillGroup
              options={AMOUNT_OPTIONS}
              value={tracksAmount ?? amountFromCount(characteristics.tracks, characteristics.windowCount)}
              onChange={(v) => {
                setTracksAmount(v);
                if (v === "not_sure") setAnyUnsure(true);
                setCharacteristics((c) => (c ? { ...c, tracks: countFromAmount(v, c.windowCount, c.tracks) } : c));
              }}
            />
          </FieldRow>
        ) : null}

        <FieldRow label="Hard-water staining" tier={tierFor(aiObservation.hardWaterStaining)}>
          <PillGroup
            options={YES_NO_OPTIONS}
            value={hardWaterAnswer ?? (characteristics.hardWaterStaining ? "yes" : "no")}
            onChange={(v) => {
              setHardWaterAnswer(v);
              if (v === "not_sure") setAnyUnsure(true);
              setCharacteristics((c) => (c ? { ...c, hardWaterStaining: v === "yes" } : c));
            }}
          />
        </FieldRow>
      </div>

      <p className="text-xs text-ink-faint">
        Tallyvis&rsquo;s pricing is always calculated from what you confirm here, never directly from
        the AI.
      </p>

      <StepFooter backHref="/estimate/photos" onContinue={handleContinue} continueDisabled={!canContinue} />
    </div>
  );
}
