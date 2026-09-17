import { useState } from "react";
import type {
  AccessibilityLevel,
  WindowCleaningCharacteristics,
  WindowType,
} from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";

const ACCESSIBILITY_OPTIONS: AccessibilityLevel[] = ["easy", "moderate", "difficult"];
const WINDOW_TYPE_OPTIONS: WindowType[] = [
  "single-hung",
  "double-hung",
  "casement",
  "sliding",
  "picture",
  "bay",
  "other",
];

function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      />
    </label>
  );
}

export interface CharacteristicsEditorProps {
  initial: WindowCleaningCharacteristics;
  onCancel: () => void;
  onSave: (updated: WindowCleaningCharacteristics) => void;
}

/**
 * Lets a business owner correct the AI's structured understanding of a job
 * — not the customer's raw photos. Saving hands the corrected
 * characteristics back through the real pricing engine (see the quote
 * detail page), it never computes a price itself.
 */
export function CharacteristicsEditor({ initial, onCancel, onSave }: CharacteristicsEditorProps) {
  const [draft, setDraft] = useState<WindowCleaningCharacteristics>(initial);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-accent bg-accent-soft p-5">
      <p className="text-sm font-semibold text-accent-strong">Editing job characteristics</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <NumberField
          label="Windows"
          value={draft.windowCount}
          onChange={(v) => setDraft({ ...draft, windowCount: v })}
        />
        <NumberField
          label="Stories"
          value={draft.stories}
          onChange={(v) => setDraft({ ...draft, stories: v })}
          min={1}
        />
        <NumberField
          label="Screens"
          value={draft.screens}
          onChange={(v) => setDraft({ ...draft, screens: v })}
        />
        <NumberField
          label="Tracks"
          value={draft.tracks}
          onChange={(v) => setDraft({ ...draft, tracks: v })}
        />
        <NumberField
          label="Est. labor (hr)"
          value={draft.estimatedLaborHours}
          onChange={(v) => setDraft({ ...draft, estimatedLaborHours: v })}
        />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Access</span>
          <select
            value={draft.accessibility}
            onChange={(e) =>
              setDraft({ ...draft, accessibility: e.target.value as AccessibilityLevel })
            }
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          >
            {ACCESSIBILITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option[0]!.toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-ink-soft">Window type</span>
          <select
            value={draft.windowType}
            onChange={(e) => setDraft({ ...draft, windowType: e.target.value as WindowType })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          >
            {WINDOW_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option[0]!.toUpperCase() + option.slice(1).replace("-", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 sm:col-span-3">
          <input
            type="checkbox"
            checked={draft.hardWaterStaining}
            onChange={(e) => setDraft({ ...draft, hardWaterStaining: e.target.checked })}
            className="h-4 w-4 rounded border-line accent-accent-strong"
          />
          <span className="text-sm text-ink">Hard-water staining present</span>
        </label>
      </div>

      <div className="flex gap-3 border-t border-accent/30 pt-4">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className={buttonVariants({ variant: "primary" })}
        >
          Save &amp; recalculate
        </button>
        <button type="button" onClick={onCancel} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
