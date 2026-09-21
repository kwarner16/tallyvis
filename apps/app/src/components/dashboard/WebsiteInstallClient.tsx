"use client";

import { useState } from "react";
import type { Business } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";

/**
 * Phase 14 — "Website → Install Tallyvis" (see
 * docs/decisions/0016-onboarding-billing-embed.md). Everything here reads
 * from the business's own record loaded server-side (see the page.tsx
 * wrapping this) — nothing is fetched by businessId from the client.
 */
function buildSnippet(appOrigin: string, publicEmbedId: string): string {
  return `<div id="tallyvis-estimator"></div>\n<script src="${appOrigin}/embed.js" data-tallyvis-id="${publicEmbedId}"></script>`;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function WebsiteInstallClient({ business, appOrigin }: { business: Business; appOrigin: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = buildSnippet(appOrigin, business.publicEmbedId);
  const previewUrl = `${appOrigin}/embed/${business.publicEmbedId}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the snippet is still selectable/copyable by hand.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Add Tallyvis to your website
        </h1>
        <p className="text-ink-soft">
          Paste this snippet into your website&rsquo;s HTML wherever you want the estimator to appear —
          no rebuild required.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Embed snippet</p>
          <button type="button" onClick={handleCopy} className={buttonVariants({ variant: "outline" })}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-ink px-4 py-3 text-xs text-paper">
          <code>{snippet}</code>
        </pre>
        <p className="mt-3 text-xs text-ink-faint">
          Your unique embed identifier: <span className="font-mono">{business.publicEmbedId}</span> —
          this is public by design (it appears in your website&rsquo;s HTML), but it can never be used
          to access your dashboard, pricing configuration, or customer data.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Preview</p>
        <div className="overflow-hidden rounded-xl border border-line">
          <iframe src={previewUrl} title="Estimator preview" className="h-[640px] w-full" />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Installation status
        </p>
        {business.embedLastSeenAt ? (
          <p className="text-sm text-ink-soft">
            <span className="font-medium text-accent-strong">Detected</span> — the embed last loaded{" "}
            {formatRelativeTime(business.embedLastSeenAt)}.
          </p>
        ) : (
          <p className="text-sm text-ink-faint">
            Not yet detected. This updates automatically the first time the snippet actually loads on a
            real page.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Test it</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-sm text-ink-soft">
          <li>Paste the snippet above into a page on your website (or any test HTML page).</li>
          <li>Load that page in a browser — the estimator should appear where you placed the snippet.</li>
          <li>Run through a full test estimate to confirm it works end to end.</li>
          <li>Come back here — &ldquo;Installation status&rdquo; above should say Detected.</li>
        </ol>
      </div>
    </div>
  );
}
