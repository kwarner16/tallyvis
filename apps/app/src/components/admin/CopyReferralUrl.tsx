"use client";

import { useState } from "react";
import { buttonVariants } from "@tallyvis/ui";

/** The one-click "copy referral URL" affordance — see the SEED/FIRST CREATOR WORKFLOW requirement in docs/decisions/0040-creator-affiliate-program.md: Kyle should get a copyable link immediately after adding a creator, with no extra steps. */
export function CopyReferralUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the URL is
      // still shown in the readonly input below for manual selection.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-paper-alt px-3 py-2 font-mono text-sm text-ink"
      />
      <button type="button" onClick={handleCopy} className={buttonVariants({ variant: "outline" })}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
