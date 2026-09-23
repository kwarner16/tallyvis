"use client";

import { useState } from "react";
import type { AccessibilityLevel } from "@tallyvis/types";
import type { JobOutcome, JobOutcomeStatus, ObservationComparisonRow, SaveJobOutcomeInput } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { recordJobOutcomeAction } from "@/lib/quoteActions";

/**
 * Phase 13 — real-world job outcome & data collection foundation. See
 * docs/decisions/0015-job-outcome-tracking.md. Records what actually
 * happened on a completed job, entirely separate from — and never
 * mutating — the quote's own historical estimate/analysis/pricing
 * configuration. Every field is optional: a business fills in what it
 * knows now (see `SaveJobOutcomeInput`) and can come back later for the
 * rest.
 */

const DIFFICULTY_OPTIONS: AccessibilityLevel[] = ["easy", "moderate", "difficult"];
const STATUS_OPTIONS: { value: JobOutcomeStatus; label: string }[] = [
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const TEXT_INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

function titleCase(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

/** `<input type="datetime-local">` works in the viewer's local time with no timezone info — converted to/from a stored ISO instant right here, at the form boundary, never anywhere data is persisted or compared. */
function toDatetimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function minutesBetween(startIso: string | undefined, endIso: string | undefined): number | undefined {
  if (!startIso || !endIso) return undefined;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return Math.round((end - start) / 60000);
}

function parseOptionalInt(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function parseOptionalFloat(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

interface Draft {
  status: JobOutcomeStatus;
  actualStartedAt: string;
  actualCompletedAt: string;
  actualLaborMinutes: string;
  actualWindowCount: string;
  actualScreenCount: string;
  actualStoryCount: string;
  actualPrice: string;
  actualDifficulty: AccessibilityLevel | "";
  notes: string;
}

function draftFromOutcome(outcome: JobOutcome | undefined): Draft {
  return {
    status: outcome?.status ?? "in_progress",
    actualStartedAt: toDatetimeLocalValue(outcome?.actualStartedAt),
    actualCompletedAt: toDatetimeLocalValue(outcome?.actualCompletedAt),
    actualLaborMinutes: outcome?.actualLaborMinutes?.toString() ?? "",
    actualWindowCount: outcome?.actualWindowCount?.toString() ?? "",
    actualScreenCount: outcome?.actualScreenCount?.toString() ?? "",
    actualStoryCount: outcome?.actualStoryCount?.toString() ?? "",
    actualPrice: outcome?.actualPrice?.toString() ?? "",
    actualDifficulty: outcome?.actualDifficulty ?? "",
    notes: outcome?.notes ?? "",
  };
}

function draftToInput(draft: Draft): SaveJobOutcomeInput {
  return {
    status: draft.status,
    actualStartedAt: fromDatetimeLocalValue(draft.actualStartedAt),
    actualCompletedAt: fromDatetimeLocalValue(draft.actualCompletedAt),
    actualLaborMinutes: parseOptionalInt(draft.actualLaborMinutes),
    actualWindowCount: parseOptionalInt(draft.actualWindowCount),
    actualScreenCount: parseOptionalInt(draft.actualScreenCount),
    actualStoryCount: parseOptionalInt(draft.actualStoryCount),
    actualPrice: parseOptionalFloat(draft.actualPrice),
    actualDifficulty: draft.actualDifficulty || undefined,
    notes: draft.notes,
  };
}

function NumberField({
  label,
  value,
  onChange,
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        type="number"
        min={0}
        step={step ?? "1"}
        value={value}
        placeholder={placeholder ?? "Not recorded"}
        onChange={(e) => onChange(e.target.value)}
        className={TEXT_INPUT_CLASS}
      />
    </label>
  );
}

function OutcomeForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Status</span>
          <select
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value as JobOutcomeStatus })}
            className={TEXT_INPUT_CLASS}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Actual price ($)"
          value={draft.actualPrice}
          step="0.01"
          onChange={(v) => onChange({ ...draft, actualPrice: v })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Actual labor (minutes)"
          value={draft.actualLaborMinutes}
          onChange={(v) => onChange({ ...draft, actualLaborMinutes: v })}
          placeholder="e.g. 90"
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Started</span>
          <input
            type="datetime-local"
            value={draft.actualStartedAt}
            onChange={(e) => onChange({ ...draft, actualStartedAt: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Finished</span>
          <input
            type="datetime-local"
            value={draft.actualCompletedAt}
            onChange={(e) => onChange({ ...draft, actualCompletedAt: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-ink-faint">
        Only enter start/finish times if you know them exactly — labor minutes alone is enough.
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        <NumberField
          label="Actual windows"
          value={draft.actualWindowCount}
          onChange={(v) => onChange({ ...draft, actualWindowCount: v })}
        />
        <NumberField
          label="Actual screens"
          value={draft.actualScreenCount}
          onChange={(v) => onChange({ ...draft, actualScreenCount: v })}
        />
        <NumberField
          label="Actual stories"
          value={draft.actualStoryCount}
          onChange={(v) => onChange({ ...draft, actualStoryCount: v })}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Actual difficulty</span>
          <select
            value={draft.actualDifficulty}
            onChange={(e) => onChange({ ...draft, actualDifficulty: e.target.value as AccessibilityLevel | "" })}
            className={TEXT_INPUT_CLASS}
          >
            <option value="">Not recorded</option>
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-soft">Notes</span>
        <textarea
          rows={2}
          value={draft.notes}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          placeholder="Anything worth remembering about how this job actually went"
          className={`resize-none ${TEXT_INPUT_CLASS}`}
        />
      </label>

      <div className="flex gap-3 border-t border-line pt-4">
        <button type="button" onClick={onSave} disabled={saving} className={buttonVariants({ variant: "primary" })}>
          {saving ? "Saving…" : "Save outcome"}
        </button>
        <button type="button" onClick={onCancel} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatVariance(value: number, unit: (v: number) => string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${unit(Math.abs(value))}`;
}

export interface JobOutcomePanelProps {
  quoteId: string;
  estimateTotal: number;
  estimatedLaborHours: number;
  initialOutcome: JobOutcome | undefined;
  observationComparison: ObservationComparisonRow[] | undefined;
}

/**
 * The quote detail page's Phase 13 addition: recording an actual job
 * outcome and, once one exists, comparing it against the original
 * estimate — plus, when this quote used AI, comparing the AI's raw
 * observation against what was ultimately confirmed. Every derived number
 * here (variance, minutes-from-times) is computed for display only, never
 * stored — the raw facts a business entered are always what's saved.
 */
export function JobOutcomePanel({
  quoteId,
  estimateTotal,
  estimatedLaborHours,
  initialOutcome,
  observationComparison,
}: JobOutcomePanelProps) {
  const [outcome, setOutcome] = useState(initialOutcome);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromOutcome(initialOutcome));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await recordJobOutcomeAction(quoteId, draftToInput(draft));
    if (result.ok) {
      setOutcome(result.data);
      setEditing(false);
    } else {
      setError(result.message);
    }
    setSaving(false);
  }

  function startEditing() {
    setDraft(draftFromOutcome(outcome));
    setError(null);
    setEditing(true);
  }

  // RAW FACTS: exactly what was entered (or `undefined` if never recorded).
  const actualLaborMinutes = outcome?.actualLaborMinutes ?? minutesBetween(outcome?.actualStartedAt, outcome?.actualCompletedAt);
  const actualLaborIsDerivedFromTimes = outcome?.actualLaborMinutes === undefined && actualLaborMinutes !== undefined;

  // DERIVED VALUES: comparisons computed from the raw facts above — never presented as a score or ranking, just the difference.
  const estimatedLaborMinutes = Math.round(estimatedLaborHours * 60);
  const laborVarianceMinutes = actualLaborMinutes !== undefined ? actualLaborMinutes - estimatedLaborMinutes : undefined;
  const priceVariance = outcome?.actualPrice !== undefined ? outcome.actualPrice - estimateTotal : undefined;

  const correctedFields = observationComparison?.filter((row) => row.corrected) ?? [];

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Actual job outcome</p>
        {!editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="text-xs font-medium text-accent-strong hover:text-accent"
          >
            {outcome ? "Edit" : "Record actual job"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {editing ? (
        <OutcomeForm draft={draft} onChange={setDraft} onSave={handleSave} onCancel={() => setEditing(false)} saving={saving} />
      ) : outcome ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                outcome.status === "completed" ? "bg-accent-soft text-accent-strong" : "bg-paper-alt text-ink-soft"
              }`}
            >
              {STATUS_OPTIONS.find((s) => s.value === outcome.status)?.label}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-faint">Actual price</dt>
              <dd className="text-sm font-medium text-ink">
                {outcome.actualPrice !== undefined ? `$${outcome.actualPrice.toFixed(2)}` : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Actual labor</dt>
              <dd className="text-sm font-medium text-ink">
                {actualLaborMinutes !== undefined
                  ? `${formatMinutes(actualLaborMinutes)}${actualLaborIsDerivedFromTimes ? " (from times)" : ""}`
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Actual difficulty</dt>
              <dd className="text-sm font-medium text-ink">
                {outcome.actualDifficulty ? titleCase(outcome.actualDifficulty) : "Not recorded"}
              </dd>
            </div>
            {outcome.actualWindowCount !== undefined ? (
              <div>
                <dt className="text-xs text-ink-faint">Actual windows</dt>
                <dd className="text-sm font-medium text-ink">{outcome.actualWindowCount}</dd>
              </div>
            ) : null}
            {outcome.actualScreenCount !== undefined ? (
              <div>
                <dt className="text-xs text-ink-faint">Actual screens</dt>
                <dd className="text-sm font-medium text-ink">{outcome.actualScreenCount}</dd>
              </div>
            ) : null}
            {outcome.actualStoryCount !== undefined ? (
              <div>
                <dt className="text-xs text-ink-faint">Actual stories</dt>
                <dd className="text-sm font-medium text-ink">{outcome.actualStoryCount}</dd>
              </div>
            ) : null}
          </dl>

          {outcome.notes ? <p className="text-sm text-ink-soft">&ldquo;{outcome.notes}&rdquo;</p> : null}

          {laborVarianceMinutes !== undefined || priceVariance !== undefined ? (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Compared to the estimate
              </p>
              <dl className="grid grid-cols-2 gap-4">
                {laborVarianceMinutes !== undefined ? (
                  <div>
                    <dt className="text-xs text-ink-faint">Labor vs. estimated ({formatMinutes(estimatedLaborMinutes)})</dt>
                    <dd className={`text-sm font-medium ${laborVarianceMinutes > 0 ? "text-accent-strong" : "text-ink"}`}>
                      {formatVariance(laborVarianceMinutes, formatMinutes)}
                    </dd>
                  </div>
                ) : null}
                {priceVariance !== undefined ? (
                  <div>
                    <dt className="text-xs text-ink-faint">Price vs. estimated (${estimateTotal.toFixed(2)})</dt>
                    <dd className={`text-sm font-medium ${priceVariance > 0 ? "text-accent-strong" : "text-ink"}`}>
                      {formatVariance(priceVariance, (v) => `$${v.toFixed(2)}`)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No actual job outcome recorded yet.</p>
      )}

      {observationComparison ? (
        <div className="border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setShowComparison((v) => !v)}
            className="text-xs font-medium text-accent-strong hover:text-accent"
          >
            {showComparison ? "Hide" : "Show"} AI observation vs. confirmed values
            {correctedFields.length > 0 ? ` (${correctedFields.length} corrected)` : ""}
          </button>
          {showComparison ? (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Field</th>
                  <th className="py-1.5 pr-3 font-medium">AI observed</th>
                  <th className="py-1.5 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {observationComparison.map((row) => (
                  <tr key={row.field}>
                    <td className="py-1.5 pr-3 text-ink-soft">{row.label}</td>
                    <td className={`py-1.5 pr-3 ${row.corrected ? "font-medium text-accent-strong" : "text-ink-faint"}`}>
                      {row.observedText ?? (row.status === "uncertain" ? "Uncertain" : "Not visible in photos")}
                    </td>
                    <td className={`py-1.5 ${row.corrected ? "font-medium text-accent-strong" : "text-ink"}`}>
                      {row.confirmedText}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
