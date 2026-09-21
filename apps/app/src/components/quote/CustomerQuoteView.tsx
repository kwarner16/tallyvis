"use client";

import { useState } from "react";
import type { Business, Quote } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { formatQuoteNumber } from "@/lib/quoteNumber";
import { PROPERTY_TYPE_LABELS } from "@/lib/propertyTypeLabels";
import { QuoteStatusBadge } from "@/components/dashboard/QuoteStatusBadge";

/** Only the fields this component actually renders — the public page's source (`PublicBusinessSummary` in `@tallyvis/api`) is intentionally narrower than the full `Business` record; the authenticated preview page happens to pass a full `Business`, which satisfies this structurally without needing its extra fields. */
type BusinessSummary = Pick<Business, "name" | "phone">;

export interface CustomerQuoteActions {
  onAccept: () => void;
  onDecline: () => void;
  onRequestChanges: (note: string) => void;
  pending: "accept" | "decline" | "request-changes" | null;
  error: string | null;
}

export interface CustomerQuoteViewProps {
  quote: Quote;
  business: BusinessSummary;
  /** Present when the quote was reached through a real share link — omitted in the business's own authenticated preview, where there's nothing to "expire". */
  expiresAt?: string;
  /**
   * Omit for a read-only view (the business previewing its own quote from
   * the dashboard). Present only on the real customer-facing page, where
   * these wire up to the actual public Server Actions.
   */
  actions?: CustomerQuoteActions;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The polished, read-only presentation of a single quote — what a customer
 * sees at `/quote/[token]` (Phase 10, wired to live Server Actions) and
 * what a business sees, unchanged, when it previews its own quote from the
 * dashboard (`actions` omitted there). One component, one visual truth for
 * both audiences — see docs/decisions/0012-secure-quote-sharing.md.
 * Presentational only: it never fetches anything and never decides
 * authorization: the caller is responsible for feeding this correctly
 * scoped data.
 */
export function CustomerQuoteView({ quote, business, expiresAt, actions }: CustomerQuoteViewProps) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [note, setNote] = useState("");

  const display = getEstimateDisplay(quote.estimate);
  const selectedServices = [
    quote.servicePreferences.interiorCleaning && "Interior window cleaning",
    quote.servicePreferences.screens && "Screen cleaning",
    quote.servicePreferences.tracks && "Track cleaning",
  ].filter(Boolean) as string[];

  const isTerminal = quote.status === "accepted" || quote.status === "declined";
  const canRespond = Boolean(actions) && quote.status === "sent";
  const canRequestChanges = Boolean(actions) && !isTerminal;

  function submitRequestChanges() {
    if (!actions || note.trim().length === 0) return;
    actions.onRequestChanges(note);
    setNote("");
    setRequestingChanges(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          {business.name}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Estimate for {quote.customer.name || "you"}
          </h1>
          <QuoteStatusBadge status={quote.status} />
        </div>
        <p className="text-xs text-ink-faint">
          Quote #{formatQuoteNumber(quote.id)} &middot; Created {formatDate(quote.createdAt)}
          {expiresAt ? <> &middot; Valid until {formatDate(expiresAt)}</> : null}
        </p>
      </div>

      {quote.status === "accepted" ? (
        <div className="rounded-2xl border border-accent bg-accent-soft p-5">
          <p className="text-sm font-semibold text-accent-strong">
            Accepted{quote.acceptedAt ? ` on ${formatDate(quote.acceptedAt)}` : ""}.
          </p>
          <p className="mt-1 text-sm text-ink-soft">{business.name} will be in touch about next steps.</p>
        </div>
      ) : null}

      {quote.status === "declined" ? (
        <div className="rounded-2xl border border-line bg-paper-alt p-5">
          <p className="text-sm font-semibold text-ink">
            Declined{quote.declinedAt ? ` on ${formatDate(quote.declinedAt)}` : ""}.
          </p>
        </div>
      ) : null}

      {quote.status !== "sent" && !isTerminal ? (
        <div className="rounded-2xl border border-line bg-paper-alt p-5">
          <p className="text-sm text-ink-soft">
            This estimate is still being finalized by {business.name}. You&rsquo;re welcome to review
            the details below, and reach out if anything needs to change.
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-paper-alt p-6">
        <p className="text-4xl font-semibold tracking-tight text-ink">
          {display.kind === "exact"
            ? `$${display.amount.toFixed(2)}`
            : `$${display.low}–$${display.high}`}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {PROPERTY_TYPE_LABELS[quote.property.propertyType]} &middot;{" "}
          {quote.property.stories >= 3 ? "3+ stories" : `${quote.property.stories}-story`}
          {quote.property.address ? ` — ${quote.property.address}` : ""}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          What&rsquo;s included
        </p>
        <p className="text-sm text-ink-soft">
          {selectedServices.length > 0 ? selectedServices.join(", ") : "Exterior window cleaning"}
        </p>
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm text-ink-soft">
          {quote.estimate.lineItems.map((item) => (
            <li key={item.label} className="flex justify-between gap-4">
              <span>{item.label}</span>
              <span className="font-mono">${item.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1 border-t border-line pt-4 text-sm">
          <div className="flex justify-between text-ink-soft">
            <span>Subtotal</span>
            <span className="font-mono">${quote.estimate.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-ink">
            <span>Total</span>
            <span className="font-mono">${quote.estimate.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {quote.notes ? (
        <div className="rounded-2xl border border-line bg-paper p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Notes</p>
          <p className="text-sm text-ink-soft">&ldquo;{quote.notes}&rdquo;</p>
        </div>
      ) : null}

      {quote.changesRequestedAt ? (
        <div className="rounded-2xl border border-line bg-paper-alt p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Your request, sent {formatDate(quote.changesRequestedAt)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">&ldquo;{quote.customerRequestNote}&rdquo;</p>
        </div>
      ) : null}

      {actions ? (
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          {actions.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {actions.error}
            </p>
          ) : null}

          {canRespond ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={actions.onAccept}
                disabled={actions.pending !== null}
                className={buttonVariants({ variant: "primary" })}
              >
                {actions.pending === "accept" ? "Accepting…" : "Accept this quote"}
              </button>
              <button
                type="button"
                onClick={actions.onDecline}
                disabled={actions.pending !== null}
                className={buttonVariants({ variant: "outline" })}
              >
                {actions.pending === "decline" ? "Declining…" : "Decline"}
              </button>
            </div>
          ) : null}

          {canRequestChanges ? (
            requestingChanges ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
                <label htmlFor="request-changes-note" className="text-sm font-medium text-ink">
                  What would you like changed?
                </label>
                <textarea
                  id="request-changes-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. can you also quote the gutters?"
                  className="resize-none rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={submitRequestChanges}
                    disabled={actions.pending !== null || note.trim().length === 0}
                    className={buttonVariants({ variant: "primary" })}
                  >
                    {actions.pending === "request-changes" ? "Sending…" : "Send request"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestingChanges(false)}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRequestingChanges(true)}
                className={buttonVariants({ variant: "outline", className: "self-start" })}
              >
                Request changes / contact {business.name}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 border-t border-line pt-6 text-xs text-ink-faint">
        <p>This link is unique to you — please don&rsquo;t forward it if you&rsquo;d rather not share it.</p>
        {business.phone ? <p>Questions? Call {business.name} at {business.phone}.</p> : null}
      </div>
    </div>
  );
}
