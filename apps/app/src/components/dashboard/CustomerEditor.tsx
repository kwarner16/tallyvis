import { useState } from "react";
import type { Customer } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";

const TEXT_INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

export interface CustomerEditorProps {
  initial: Customer;
  onCancel: () => void;
  onSave: (updated: Customer) => void;
}

/**
 * Corrects a quote's customer contact details (a typo'd email, an added
 * phone number). Distinct from `CharacteristicsEditor`: customer info
 * doesn't feed pricing, so saving here never touches the estimate.
 */
export function CustomerEditor({ initial, onCancel, onSave }: CustomerEditorProps) {
  const [draft, setDraft] = useState<Customer>(initial);
  const canSave = draft.name.trim().length > 0 && /\S+@\S+\.\S+/.test(draft.email);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-accent bg-accent-soft p-5">
      <p className="text-sm font-semibold text-accent-strong">Editing customer</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Email</span>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-ink-soft">Phone</span>
          <input
            type="tel"
            value={draft.phone ?? ""}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            className={`${TEXT_INPUT_CLASS} sm:max-w-xs`}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 border-t border-accent/30 pt-4">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({ ...draft, phone: draft.phone?.trim() || undefined })}
          className={buttonVariants({ variant: "primary" })}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </button>
        {!canSave ? <span className="text-xs text-ink-faint">Name and a valid email are required.</span> : null}
      </div>
    </div>
  );
}
