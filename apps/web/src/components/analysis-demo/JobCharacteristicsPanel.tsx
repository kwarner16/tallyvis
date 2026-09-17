import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import type { CharacteristicKey } from "./types";

interface Row {
  key: CharacteristicKey;
  label: string;
  value: string;
}

function buildRows(characteristics: WindowCleaningCharacteristics): Row[] {
  return [
    { key: "windows", label: "Windows detected", value: String(characteristics.windowCount) },
    { key: "stories", label: "Stories", value: String(characteristics.stories) },
    { key: "screens", label: "Screens", value: String(characteristics.screens) },
    { key: "windowType", label: "Window type", value: "Double-hung" },
    { key: "access", label: "Access", value: "Moderate" },
    { key: "labor", label: "Estimated labor", value: `~${characteristics.estimatedLaborHours} hr` },
  ];
}

export interface JobCharacteristicsPanelProps {
  characteristics: WindowCleaningCharacteristics;
  revealed: Set<CharacteristicKey>;
}

export function JobCharacteristicsPanel({
  characteristics,
  revealed,
}: JobCharacteristicsPanelProps) {
  const rows = buildRows(characteristics);

  return (
    <div className="rounded-2xl border border-line bg-paper p-6">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">
        Tallyvis analysis
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        {rows.map((row) => {
          const isRevealed = revealed.has(row.key);
          return (
            <div key={row.key} className="flex flex-col gap-1">
              {isRevealed ? (
                <div style={{ animation: "fade-in 0.35s ease-out" }}>
                  <p className="text-2xl font-semibold text-ink">{row.value}</p>
                  <p className="text-xs text-ink-soft">{row.label}</p>
                </div>
              ) : (
                <div aria-hidden="true">
                  <p className="text-2xl font-semibold text-line">&ndash;&ndash;</p>
                  <p className="text-xs text-line">{row.label}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
