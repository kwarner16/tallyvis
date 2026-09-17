import { useState } from "react";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { JobCharacteristicsFields } from "./JobCharacteristicsFields";

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

      <JobCharacteristicsFields value={draft} onChange={setDraft} />

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
