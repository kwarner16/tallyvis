import type { AccessibilityLevel, WindowCleaningCharacteristics, WindowType } from "@tallyvis/types";

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

export interface JobCharacteristicsFieldsProps {
  value: WindowCleaningCharacteristics;
  onChange: (value: WindowCleaningCharacteristics) => void;
  /**
   * Hide the "Stories" field when the caller already collects story count
   * elsewhere (e.g. the create-quote flow's Property section) — showing it
   * twice risks the two values silently disagreeing.
   */
  showStories?: boolean;
}

/**
 * The window-cleaning job-characteristics field set — what's actually
 * present on the property (window count, screens, tracks, access,
 * hard-water staining), as distinct from what the customer wants done
 * (`ServicePreferences`, collected separately). Shared by `CharacteristicsEditor`
 * (correcting an existing quote's analysis) and the "Create quote" flow
 * (entering it for the first time) so the two have exactly one field set
 * between them.
 */
export function JobCharacteristicsFields({
  value,
  onChange,
  showStories = true,
}: JobCharacteristicsFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <NumberField
        label="Windows"
        value={value.windowCount}
        onChange={(v) => onChange({ ...value, windowCount: v })}
      />
      {showStories ? (
        <NumberField
          label="Stories"
          value={value.stories}
          onChange={(v) => onChange({ ...value, stories: v })}
          min={1}
        />
      ) : null}
      <NumberField
        label="Screens"
        value={value.screens}
        onChange={(v) => onChange({ ...value, screens: v })}
      />
      <NumberField
        label="Tracks"
        value={value.tracks}
        onChange={(v) => onChange({ ...value, tracks: v })}
      />
      <NumberField
        label="Est. labor (hr)"
        value={value.estimatedLaborHours}
        onChange={(v) => onChange({ ...value, estimatedLaborHours: v })}
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-soft">Access</span>
        <select
          value={value.accessibility}
          onChange={(e) => onChange({ ...value, accessibility: e.target.value as AccessibilityLevel })}
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
          value={value.windowType}
          onChange={(e) => onChange({ ...value, windowType: e.target.value as WindowType })}
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
          checked={value.hardWaterStaining}
          onChange={(e) => onChange({ ...value, hardWaterStaining: e.target.checked })}
          className="h-4 w-4 rounded border-line accent-accent-strong"
        />
        <span className="text-sm text-ink">Hard-water staining present</span>
      </label>
    </div>
  );
}
