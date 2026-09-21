"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Quote } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import {
  generateQuoteShareLinkAction,
  getQuoteShareLinkStatusAction,
  revokeQuoteShareLinkAction,
  type ShareLinkView,
} from "@/lib/quoteActions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Business-side quote sharing (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md). Every action here goes
 * through a Server Action that re-derives the business from the session
 * cookie, so this component never needs to (and never could) assert
 * ownership itself.
 *
 * The raw share URL is only ever available immediately after
 * generate/regenerate — the database only stores the token's hash, so
 * there is no way to read an existing link back out. Once the business
 * navigates away without copying it, the panel can only tell them a link
 * is active, not what it is; "Regenerate" issues a new one they can copy.
 */
export function ShareQuotePanel({ quote }: { quote: Quote }) {
  const quoteId = quote.id;
  const [status, setStatus] = useState<ShareLinkView | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"generate" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getQuoteShareLinkStatusAction(quoteId)
      .then(setStatus)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load this quote's customer link.");
        setStatus({ active: false });
      });
  }, [quoteId]);

  async function handleGenerate() {
    setBusy("generate");
    setError(null);
    try {
      const result = await generateQuoteShareLinkAction(quoteId);
      setStatus(result);
      setFreshUrl(result.url ?? null);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a customer link.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevoke() {
    setBusy("revoke");
    setError(null);
    try {
      await revokeQuoteShareLinkAction(quoteId);
      setStatus({ active: false });
      setFreshUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this link.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, non-HTTPS, older browsers) — the URL is still selectable text either way.
    }
  }

  if (status === null) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Customer link</p>
        <p className="mt-2 text-sm text-ink-faint">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Customer link</p>
        {status.active ? (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            Active
          </span>
        ) : (
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-ink-faint">
            No link yet
          </span>
        )}
      </div>

      <p className="text-sm text-ink-soft">
        A secure link a customer can open without signing in — separate from{" "}
        <Link href={`/dashboard/quotes/${quoteId}`} className="underline decoration-dotted">
          this internal dashboard page
        </Link>
        , which they can never reach.
      </p>

      {status.active && status.createdAt ? (
        <p className="text-xs text-ink-faint">
          Generated {formatDate(status.createdAt)}
          {status.expiresAt ? ` · expires ${formatDate(status.expiresAt)}` : ""}
        </p>
      ) : null}

      {status.active ? (
        <div className="rounded-lg border border-line bg-paper-alt px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Customer activity
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {quote.firstViewedAt
              ? `Viewed ${formatDateTime(quote.firstViewedAt)}${
                  quote.lastViewedAt && quote.lastViewedAt !== quote.firstViewedAt
                    ? ` · last viewed ${formatDateTime(quote.lastViewedAt)}`
                    : ""
                }`
              : "Not yet viewed by the customer."}
          </p>
          {quote.changesRequestedAt ? (
            <p className="mt-2 text-sm text-ink-soft">
              <span className="font-medium text-ink">
                Requested changes {formatDateTime(quote.changesRequestedAt)}:
              </span>{" "}
              &ldquo;{quote.customerRequestNote}&rdquo;
            </p>
          ) : null}
        </div>
      ) : null}

      {freshUrl ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent bg-accent-soft p-3">
          <p className="text-xs font-medium text-accent-strong">
            Copy this link now — for security, it won&rsquo;t be shown again after you leave this page.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={freshUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink"
            />
            <button
              type="button"
              onClick={handleCopy}
              className={buttonVariants({ variant: "primary", className: "shrink-0" })}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy !== null}
          className={buttonVariants({ variant: status.active ? "outline" : "primary" })}
        >
          {busy === "generate" ? "Generating…" : status.active ? "Regenerate link" : "Generate customer link"}
        </button>
        {status.active ? (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={busy !== null}
            className={buttonVariants({ variant: "outline" })}
          >
            {busy === "revoke" ? "Revoking…" : "Revoke"}
          </button>
        ) : null}
        <Link
          href={`/dashboard/quotes/${quoteId}/preview`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          Preview
        </Link>
      </div>
    </div>
  );
}
