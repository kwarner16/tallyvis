"use client";

import { useState } from "react";
import type { Business } from "@tallyvis/types";
import { buttonVariants, cn } from "@tallyvis/ui";
import { buildIframeSnippet, buildScriptSnippet } from "@/lib/embedSnippets";

/**
 * Phase 14 — "Website → Install Tallyvis" (see
 * docs/decisions/0016-onboarding-billing-embed.md), rebuilt in Phase 15
 * (docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) into a
 * platform picker covering the site builders Adam (customer discovery)
 * actually needs: WordPress, GoDaddy, Shopify, a generic custom-HTML site,
 * and a raw iframe fallback for anything that restricts script injection.
 * Everything here reads from the business's own record loaded server-side
 * (see the page.tsx wrapping this) — nothing is fetched by businessId from
 * the client.
 */

type PlatformKey = "wordpress" | "godaddy" | "shopify" | "custom" | "iframe";

interface PlatformGuide {
  label: string;
  snippetKind: "script" | "iframe";
  steps: string[];
  note?: string;
}

const PLATFORM_GUIDES: Record<PlatformKey, PlatformGuide> = {
  wordpress: {
    label: "WordPress",
    snippetKind: "script",
    steps: [
      "In the WordPress block editor, add a “Custom HTML” block wherever you want the estimator to appear.",
      "Paste the snippet below into that block.",
      "Publish or update the page.",
    ],
    note: "Some WordPress.com plans strip raw <script> tags from Custom HTML blocks — if the estimator doesn't appear after publishing, switch to the Iframe tab instead.",
  },
  godaddy: {
    label: "GoDaddy",
    snippetKind: "iframe",
    steps: [
      "In GoDaddy Website Builder, add an “Embed” or “HTML” section wherever you want the estimator.",
      "Paste the iframe snippet below into it.",
      "Publish your site.",
    ],
    note: "GoDaddy's HTML embed block commonly strips <script> tags depending on your plan, so the iframe snippet is the most reliable option here — REQUIRES HUMAN PLATFORM TEST on your specific plan.",
  },
  shopify: {
    label: "Shopify",
    snippetKind: "script",
    steps: [
      "In your Shopify theme editor, add a “Custom Liquid” section (or an app-embed block) wherever you want the estimator.",
      "Paste the snippet below into it.",
      "Save and publish your theme.",
    ],
    note: "If your theme blocks script execution in that section, switch to the Iframe tab — it works the same way across every Shopify theme.",
  },
  custom: {
    label: "Custom website",
    snippetKind: "script",
    steps: [
      "Open your site's HTML, or your site builder's “Custom code”/“Embed” feature.",
      "Paste the snippet below wherever you want the estimator to appear (just before </body> works well).",
      "Save and publish.",
    ],
  },
  iframe: {
    label: "Iframe",
    snippetKind: "iframe",
    steps: [
      "Use this if your website only accepts a URL, or a plain iframe/HTML block with no <script> tags allowed.",
      "Paste the snippet below wherever you want the estimator to appear.",
    ],
  },
};

const PLATFORM_ORDER: PlatformKey[] = ["wordpress", "godaddy", "shopify", "custom", "iframe"];

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
  const [platform, setPlatform] = useState<PlatformKey>("wordpress");
  const [copied, setCopied] = useState(false);

  const guide = PLATFORM_GUIDES[platform];
  const snippet =
    guide.snippetKind === "iframe"
      ? buildIframeSnippet(appOrigin, business.publicEmbedId)
      : buildScriptSnippet(appOrigin, business.publicEmbedId);
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
          Choose your website, then copy the snippet below — no rebuild required. No installation fee
          right now; reach out and Kyle will personally help if you get stuck.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Choose your website
        </p>
        <div
          role="tablist"
          aria-label="Website platform"
          className="flex flex-wrap gap-2"
        >
          {PLATFORM_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={platform === key}
              onClick={() => setPlatform(key)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                platform === key
                  ? "border-accent-strong bg-accent-strong text-accent-foreground"
                  : "border-line bg-paper text-ink-soft hover:border-accent-strong hover:text-ink",
              )}
            >
              {PLATFORM_GUIDES[key].label}
            </button>
          ))}
        </div>

        <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-4 text-sm text-ink-soft">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {guide.note ? <p className="mt-3 text-xs text-ink-faint">{guide.note}</p> : null}

        <div className="mt-4 mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {guide.snippetKind === "iframe" ? "Iframe snippet" : "Script snippet"}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className={buttonVariants({ variant: "outline", className: "shrink-0" })}
          >
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
            <span className="font-medium text-accent-strong">Connected</span> — the embed last loaded{" "}
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
          <li>Come back here — &ldquo;Installation status&rdquo; above should say Connected.</li>
        </ol>
      </div>
    </div>
  );
}
