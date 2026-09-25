"use client";

import { useMemo, useState } from "react";
import {
  BENCHMARK_CONDITIONS,
  type AccessibilityLevel,
  type BenchmarkCondition,
  type PropertyType,
  type WindowCleaningCharacteristics,
} from "@tallyvis/types";
import type { BenchmarkCase, BenchmarkMetrics } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import {
  analyzeBenchmarkPhotosAction,
  deleteBenchmarkCaseAction,
  getBenchmarkMetricsAction,
  listBenchmarkCasesAction,
  saveBenchmarkCaseAction,
  type BenchmarkAnalysisResult,
} from "@/lib/benchmarkActions";
import { compressImageFile, ImageCompressionError, MAX_SOURCE_FILE_BYTES } from "@/lib/imageCompression";
import { defaultWindowCleaningCharacteristics } from "@/lib/defaultCharacteristics";
import { OptionButton } from "@/components/OptionButton";
import { JobCharacteristicsFields } from "@/components/dashboard/JobCharacteristicsFields";
import { AiObservationSummary } from "@/components/dashboard/AiObservationSummary";

/**
 * Final validation & launch-readiness phase (2026-09) — internal estimator
 * benchmark harness UI. Deliberately a single dense page rather than a
 * multi-step wizard (mirrors NewQuoteClient's own reasoning): a table plus
 * summary cards is enough for V1 (mission Part 5), and this is a tool for
 * Tallyvis's own testing, not a customer-facing flow that needs polish for
 * its own sake.
 *
 * Photos are compressed with the same imageCompression.ts pipeline and
 * analyzed through the same analyzePropertyForBusiness pipeline every real
 * quote uses (see benchmarkActions.ts's analyzeBenchmarkPhotosAction) —
 * never a second AI implementation. Photo bytes never leave this
 * component's own state: only `photoCount` is ever sent to
 * `saveBenchmarkCaseAction`, matching the harness's deliberate
 * no-permanent-photo-retention design (see
 * services/api/src/services/benchmarkCases.ts's own comment).
 */

const CONDITION_LABELS: Record<BenchmarkCondition, string> = {
  clear_daylight: "Clear daylight",
  overcast: "Overcast",
  bright_sun: "Bright sun",
  glare_reflection: "Glare/reflection",
  dusk: "Dusk",
  low_light: "Low light",
  distant_photo: "Distant/across-street photo",
  close_up_photo: "Close-up photo",
  mixed_distances: "Mixed distances",
  trees_bushes: "Trees/bushes",
  partial_obstruction: "Partial obstruction",
  blurry_image: "Blurry image",
  poor_quality_image: "Poor-quality image",
  multi_story: "Multi-story",
  townhouse: "Townhouse",
  neighboring_property_visible: "Neighboring property visible",
  missing_property_side: "Missing property side",
  unusual_grouped_bay_windows: "Unusual/grouped/bay windows",
  glass_doors: "Glass doors",
  screens: "Screens",
  other: "Other",
};

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "single-family", label: "Single-family" },
  { value: "townhouse", label: "Townhouse" },
  { value: "other", label: "Other" },
];

const ACCESSIBILITY_OPTIONS: AccessibilityLevel[] = ["easy", "moderate", "difficult"];

interface AnalysisPhoto {
  id: string;
  name: string;
  dataUrl: string;
}

function nowForDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function pct(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return value.toFixed(digits);
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper p-4">
      <p className="text-xs font-medium text-ink-faint">{label}</p>
      <p className="text-xl font-semibold text-ink">{value}</p>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function BenchmarkTestingClient({
  initialCases,
  initialMetrics,
}: {
  initialCases: BenchmarkCase[];
  initialMetrics: BenchmarkMetrics;
}) {
  const [cases, setCases] = useState<BenchmarkCase[]>(initialCases);
  const [metrics, setMetrics] = useState<BenchmarkMetrics>(initialMetrics);

  // --- test info ---
  const [testName, setTestName] = useState("");
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null);
  const [testedAt, setTestedAt] = useState(nowForDatetimeLocal());
  const [notes, setNotes] = useState("");
  const [conditions, setConditions] = useState<Set<BenchmarkCondition>>(new Set());
  const [reportedStories, setReportedStories] = useState<number | "">("");
  const [previousCaseId, setPreviousCaseId] = useState<string>("");

  // --- photos + analysis ---
  const [photos, setPhotos] = useState<AnalysisPhoto[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [result, setResult] = useState<BenchmarkAnalysisResult | null>(null);
  const [confirmed, setConfirmed] = useState<WindowCleaningCharacteristics>(defaultWindowCleaningCharacteristics());
  const [anyUnsure, setAnyUnsure] = useState(false);

  // --- ground truth ---
  const [gtWindowCount, setGtWindowCount] = useState<number | "">("");
  const [gtScreenCount, setGtScreenCount] = useState<number | "">("");
  const [gtStories, setGtStories] = useState<number | "">("");
  const [gtAccessibility, setGtAccessibility] = useState<AccessibilityLevel | "">("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function toggleCondition(tag: BenchmarkCondition) {
    setConditions((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function refresh() {
    const [casesResult, metricsResult] = await Promise.all([listBenchmarkCasesAction(), getBenchmarkMetricsAction()]);
    if (casesResult.ok) setCases(casesResult.data);
    if (metricsResult.ok) setMetrics(metricsResult.data);
  }

  async function handleAddPhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setAnalyzeError(null);
    const remainingSlots = 6 - photos.length;
    const toProcess = Array.from(fileList).slice(0, remainingSlots).filter((f) => f.type.startsWith("image/"));
    if (toProcess.length === 0) return;

    setProcessingPhotos(true);
    const accepted: AnalysisPhoto[] = [];
    try {
      for (const file of toProcess) {
        if (file.size > MAX_SOURCE_FILE_BYTES) {
          setAnalyzeError(`${file.name} is too large to process and was skipped.`);
          continue;
        }
        try {
          const { dataUrl } = await compressImageFile(file);
          accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, dataUrl });
        } catch (err) {
          setAnalyzeError(err instanceof ImageCompressionError ? err.message : `${file.name} couldn't be processed.`);
        }
      }
    } finally {
      setProcessingPhotos(false);
    }
    if (accepted.length > 0) setPhotos((prev) => [...prev, ...accepted]);
  }

  function handleRemovePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleAnalyze() {
    if (photos.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    const response = await analyzeBenchmarkPhotosAction({
      images: photos.map((p) => ({ url: p.dataUrl })),
      property: { stories: reportedStories === "" ? undefined : reportedStories, address: address.trim() || undefined },
    });
    if (response.ok) {
      setResult(response.data);
      setConfirmed(response.data.analysis.characteristics);
      setAnyUnsure(false);
    } else {
      setAnalyzeError(response.message);
    }
    setAnalyzing(false);
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    const response = await saveBenchmarkCaseAction({
      testName: testName.trim() || undefined,
      address: address.trim() || undefined,
      propertyType: propertyType ?? undefined,
      testedAt: new Date(testedAt).toISOString(),
      notes,
      conditions: Array.from(conditions),
      photoCount: photos.length,
      observation: result.observation,
      reconciledCharacteristics: result.analysis.characteristics,
      confirmedCharacteristics: confirmed,
      anyUnsure,
      groundTruth: {
        windowCount: gtWindowCount === "" ? undefined : gtWindowCount,
        screenCount: gtScreenCount === "" ? undefined : gtScreenCount,
        stories: gtStories === "" ? undefined : gtStories,
        accessibility: gtAccessibility === "" ? undefined : gtAccessibility,
      },
      previousCaseId: previousCaseId || undefined,
    });
    if (response.ok) {
      // Reset the form for the next case, but keep the tester's place in
      // the results below — they're usually about to run another case
      // against the same property.
      setPhotos([]);
      setResult(null);
      setTestName("");
      setNotes("");
      setGtWindowCount("");
      setGtScreenCount("");
      setGtStories("");
      setGtAccessibility("");
      setPreviousCaseId("");
      await refresh();
    } else {
      setSaveError(response.message);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await deleteBenchmarkCaseAction(id);
    await refresh();
  }

  const canAnalyze = photos.length > 0 && !analyzing && !processingPhotos;
  const canSave = result !== null && !saving;

  const evidenceRows = useMemo(
    () =>
      metrics.evidenceBreakdown.map((row) => ({
        ...row,
        label: row.tier === "sufficient" ? "Sufficient" : row.tier === "usable_with_uncertainty" ? "Usable with uncertainty" : "Insufficient",
      })),
    [metrics.evidenceBreakdown],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">AI estimator testing</h1>
        <p className="text-ink-soft">
          Internal benchmark harness — run real property photos through the exact AI pipeline customers
          use, enter what&rsquo;s actually true about the property, and see how accurate the estimator
          really is. Photos are analyzed and then discarded; only the results are saved.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Test case</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Test name (optional)</span>
                <input
                  type="text"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  placeholder="e.g. Two-story, distant photos"
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Address (optional)</span>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Date/time</span>
                <input
                  type="datetime-local"
                  value={testedAt}
                  onChange={(e) => setTestedAt(e.target.value)}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Reported stories (what a customer would guess, optional)</span>
                <input
                  type="number"
                  min={1}
                  value={reportedStories}
                  onChange={(e) => setReportedStories(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-medium text-ink-soft">Property type (optional)</legend>
              <div className="grid grid-cols-3 gap-2">
                {PROPERTY_TYPES.map((opt) => (
                  <OptionButton key={opt.value} selected={propertyType === opt.value} onClick={() => setPropertyType(opt.value)}>
                    {opt.label}
                  </OptionButton>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-medium text-ink-soft">Test conditions</legend>
              <div className="flex flex-wrap gap-2">
                {BENCHMARK_CONDITIONS.map((tag) => (
                  <OptionButton key={tag} selected={conditions.has(tag)} onClick={() => toggleCondition(tag)}>
                    {CONDITION_LABELS[tag]}
                  </OptionButton>
                ))}
              </div>
            </fieldset>

            {cases.length > 0 ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">
                  Follow-up to (optional) — link this case to an earlier one for the same property to measure
                  whether additional photos improved accuracy
                </span>
                <select
                  value={previousCaseId}
                  onChange={(e) => setPreviousCaseId(e.target.value)}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                >
                  <option value="">None</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.testName || c.address || c.id} ({new Date(c.createdAt).toLocaleString()})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Photos</p>
            <p className="text-xs text-ink-faint">
              Compressed the same way the real estimator compresses customer photos, then analyzed and
              discarded — only the AI&rsquo;s results are saved below, never the photo itself.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleAddPhotos(e.target.files)}
              disabled={processingPhotos || photos.length >= 6}
              className="text-sm text-ink-soft"
            />
            {photos.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {photos.map((p) => (
                  <div key={p.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local blob/data URL preview, not an optimizable remote asset */}
                    <img src={p.dataUrl} alt={p.name} className="h-20 w-20 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(p.id)}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-paper"
                      aria-label={`Remove ${p.name}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {analyzeError ? <p className="text-sm text-accent-strong">{analyzeError}</p> : null}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className={buttonVariants({ variant: "primary", className: "self-start" })}
            >
              {analyzing ? "Analyzing…" : "Analyze with AI"}
            </button>
          </section>

          {result ? (
            <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">AI result</p>
              <AiObservationSummary observation={result.observation} />

              <div className="rounded-xl border border-line bg-paper-alt p-4 text-sm text-ink-soft">
                <p className="font-medium text-ink">
                  Evidence: {result.observation.evidence.overallEvidence.replace(/_/g, " ")} (coverage:{" "}
                  {result.observation.evidence.coverage})
                </p>
                {result.evidenceMessages.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 text-xs">
                    {result.evidenceMessages.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs">No additional photos would be requested.</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Simulated customer confirmation (final confirmed characteristics)
                </p>
                <JobCharacteristicsFields value={confirmed} onChange={setConfirmed} />
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={anyUnsure} onChange={(e) => setAnyUnsure(e.target.checked)} className="h-4 w-4" />
                  Simulate the customer answering &ldquo;not sure&rdquo; to at least one confirmation question
                </label>
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Ground truth</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Actual windows</span>
                <input
                  type="number"
                  min={0}
                  value={gtWindowCount}
                  onChange={(e) => setGtWindowCount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Actual screens</span>
                <input
                  type="number"
                  min={0}
                  value={gtScreenCount}
                  onChange={(e) => setGtScreenCount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Actual stories</span>
                <input
                  type="number"
                  min={1}
                  value={gtStories}
                  onChange={(e) => setGtStories(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-soft">Actual access</span>
                <select
                  value={gtAccessibility}
                  onChange={(e) => setGtAccessibility(e.target.value as AccessibilityLevel | "")}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                >
                  <option value="">Unknown</option>
                  {ACCESSIBILITY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt[0]!.toUpperCase() + opt.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {saveError ? <p className="text-sm text-accent-strong">{saveError}</p> : null}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={buttonVariants({ variant: "primary", className: "self-start" })}
            >
              {saving ? "Saving…" : "Save test case"}
            </button>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Summary ({metrics.totalCases} case{metrics.totalCases === 1 ? "" : "s"})
            </p>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Raw window recall" value={pct(metrics.avgRawRecall)} hint="AI count / actual count, avg" />
              <MetricCard label="Overcount rate" value={pct(metrics.overcountRate)} />
              <MetricCard label="Avg abs. window error" value={num(metrics.avgAbsWindowError, 1)} />
              <MetricCard label="Exact count rate" value={pct(metrics.exactCountRate)} />
              <MetricCard label="Within ±1" value={pct(metrics.within1Rate)} />
              <MetricCard label="Within ±2" value={pct(metrics.within2Rate)} />
              <MetricCard label="AI declined to count" value={pct(metrics.aiDeclinedToCountRate)} />
              <MetricCard label="Avg abs. screen error" value={num(metrics.avgAbsScreenError, 1)} />
              <MetricCard label="Confirmed exact rate" value={pct(metrics.confirmedExactCountRate)} hint="After customer correction" />
              <MetricCard label="Confirmed avg abs. error" value={num(metrics.avgAbsConfirmedWindowError, 1)} />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Evidence-warning effectiveness</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="pb-1">Evidence tier</th>
                  <th className="pb-1">Cases</th>
                  <th className="pb-1">Within ±1</th>
                </tr>
              </thead>
              <tbody>
                {evidenceRows.map((row) => (
                  <tr key={row.tier} className="border-t border-line">
                    <td className="py-1 text-ink">{row.label}</td>
                    <td className="py-1 text-ink-soft">{row.count}</td>
                    <td className="py-1 text-ink-soft">{pct(row.within1Rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Follow-up photo behavior</p>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">More photos recommended</dt>
                <dd className="font-medium text-ink">{metrics.followUpPhotos.recommendedCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Followed by a linked re-run</dt>
                <dd className="font-medium text-ink">{metrics.followUpPhotos.followUpCasesCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Re-run improved accuracy</dt>
                <dd className="font-medium text-ink">{metrics.followUpPhotos.improvedCount}</dd>
              </div>
            </dl>
          </section>

          {metrics.byCondition.length > 0 ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">By condition</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-faint">
                    <th className="pb-1">Condition</th>
                    <th className="pb-1">n</th>
                    <th className="pb-1">Avg error</th>
                    <th className="pb-1">±1</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byCondition.map((row) => (
                    <tr key={row.condition} className="border-t border-line">
                      <td className="py-1 text-ink">{CONDITION_LABELS[row.condition]}</td>
                      <td className="py-1 text-ink-soft">{row.count}</td>
                      <td className="py-1 text-ink-soft">{num(row.avgAbsWindowError, 1)}</td>
                      <td className="py-1 text-ink-soft">{pct(row.within1Rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">All test cases</p>
        {cases.length === 0 ? (
          <p className="text-sm text-ink-soft">No benchmark cases recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="pb-2">Case</th>
                  <th className="pb-2">Conditions</th>
                  <th className="pb-2">AI windows</th>
                  <th className="pb-2">Confirmed windows</th>
                  <th className="pb-2">Actual windows</th>
                  <th className="pb-2">Evidence</th>
                  <th className="pb-2">Needs review</th>
                  <th className="pb-2">Final price</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-2 text-ink">
                      <p className="font-medium">{c.testName || c.address || "Untitled"}</p>
                      <p className="text-ink-faint">{new Date(c.createdAt).toLocaleString()}</p>
                    </td>
                    <td className="py-2 text-ink-soft">
                      {c.conditions.map((tag) => CONDITION_LABELS[tag]).join(", ") || "—"}
                    </td>
                    <td className="py-2 text-ink-soft">
                      {c.ai.windowStatus === "observed" ? c.ai.windowCount : c.ai.windowStatus}
                    </td>
                    <td className="py-2 text-ink-soft">{c.confirmed.characteristics.windowCount}</td>
                    <td className="py-2 text-ink-soft">{c.groundTruth.windowCount ?? "—"}</td>
                    <td className="py-2 text-ink-soft">{c.ai.evidenceOverall.replace(/_/g, " ")}</td>
                    <td className="py-2 text-ink-soft">{c.confirmed.wouldNeedReview ? "Yes" : "No"}</td>
                    <td className="py-2 text-ink-soft">${c.confirmed.estimate.total.toFixed(2)}</td>
                    <td className="py-2">
                      <button type="button" onClick={() => handleDelete(c.id)} className="text-accent-strong hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
