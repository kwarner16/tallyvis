"use client";

import { useActionState } from "react";
import { buttonVariants, cn } from "@tallyvis/ui";
import {
  previewCreatorImportAction,
  importCreatorProspectsAction,
  type CreatorImportPreviewState,
} from "@/lib/creatorOutreachActions";

const initialState: CreatorImportPreviewState = {};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  duplicate: "Already imported/contacted",
  possible_duplicate: "Possible duplicate",
  invalid: "Invalid",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new: "bg-green-100 text-green-700",
  duplicate: "bg-paper-alt text-ink-faint",
  possible_duplicate: "bg-amber-100 text-amber-800",
  invalid: "bg-red-100 text-red-700",
};

/**
 * Two-step paste-preview-import flow — identical shape to the Sales
 * Call Tracker's `ImportPreviewClient` (see
 * docs/decisions/0042-creator-outreach-tracker.md). The second form
 * resubmits the EXACT same raw text the preview parsed —
 * `importCreatorProspectsAction` re-parses and re-classifies it
 * server-side from scratch rather than trusting anything this
 * component displays.
 */
export function CreatorOutreachImportPreviewClient() {
  const [previewState, previewAction, previewPending] = useActionState(previewCreatorImportAction, initialState);
  const [importState, importAction, importPending] = useActionState(importCreatorProspectsAction, initialState);

  const classification = previewState.classification;

  return (
    <div className="flex flex-col gap-6">
      <form action={previewAction} className="flex flex-col gap-3">
        <label htmlFor="rawText" className="text-sm font-medium text-ink">
          Paste creator prospect list
        </label>
        <textarea
          id="rawText"
          name="rawText"
          rows={10}
          defaultValue={previewState.rawText}
          placeholder={
            "Creator Name | Contact Name | Email | Primary Platform | Profile URL | Other Platforms | Niche | Followers | Source\n" +
            "SteveO The Window Cleaner | Steve | steve@example.com | YouTube | https://youtube.com/@steveo | | Window Cleaning | 42K | ChatGPT"
          }
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
        <button type="submit" disabled={previewPending} className={buttonVariants({ variant: "outline", className: "self-start" })}>
          {previewPending ? "Checking…" : "Preview import"}
        </button>
        {previewState.error ? <p className="text-sm text-red-700">{previewState.error}</p> : null}
      </form>

      {classification ? (
        <section className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink">
            {classification.rows.length} creator{classification.rows.length === 1 ? "" : "s"} detected — {classification.counts.new}{" "}
            new, {classification.counts.duplicate} already imported/contacted, {classification.counts.possible_duplicate} possible
            duplicate{classification.counts.possible_duplicate === 1 ? "" : "s"}, {classification.counts.invalid} invalid.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Line</th>
                  <th className="px-4 py-3 font-medium">Creator</th>
                  <th className="px-4 py-3 font-medium">Email / URL</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {classification.rows.map((row) => (
                  <tr key={row.lineNumber}>
                    <td className="px-4 py-3 text-ink-faint">{row.lineNumber}</td>
                    <td className="px-4 py-3 font-medium text-ink">{row.displayName || "—"}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{row.email || row.profileUrl || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_BADGE_CLASS[row.status])}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {row.status === "invalid" ? row.errors.join(" ") : null}
                      {row.status === "duplicate" ? "Already in TallyVis." : null}
                      {row.status === "possible_duplicate" ? "A prospect with this exact creator name already exists." : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={importAction}>
            <input type="hidden" name="rawText" value={previewState.rawText ?? ""} />
            <button
              type="submit"
              disabled={importPending || classification.counts.new === 0}
              className={buttonVariants({ variant: "primary" })}
            >
              {importPending
                ? "Importing…"
                : `Import ${classification.counts.new} New Creator Prospect${classification.counts.new === 1 ? "" : "s"}`}
            </button>
            {importState.error ? <p className="mt-2 text-sm text-red-700">{importState.error}</p> : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
