"use client";

import { useState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { renderOutreachEmail1, renderOutreachEmail2 } from "@tallyvis/config";

/**
 * One-click "Copy Email #1/#2" — see
 * docs/decisions/0042-creator-outreach-tracker.md's "Email template
 * behavior" section. Renders the plain-text template client-side
 * (no server round trip) so the preview always reflects the prospect's
 * current contact name, and copies the exact same text the preview
 * shows — nothing is sent automatically; Kyle pastes, personalizes, and
 * sends by hand.
 */
export function CopyEmailButton({
  label,
  template,
  contactName,
}: {
  label: string;
  template: "email1" | "email2";
  contactName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = template === "email1" ? renderOutreachEmail1(contactName) : renderOutreachEmail2(contactName);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the text is still shown below for manual selection.
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <button
          type="button"
          onClick={handleCopy}
          className={buttonVariants({ variant: copied ? "primary" : "outline", className: "px-3 py-1.5 text-xs" })}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-lg border border-line bg-paper-alt px-3 py-2 font-mono text-xs text-ink-soft"
      />
    </div>
  );
}
