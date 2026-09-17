"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Quote } from "@tallyvis/types";
import { demoBusiness } from "@tallyvis/config";
import { getQuote } from "@/lib/quotes/store";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { QUOTE_STATUS_LABELS } from "@/lib/quoteStatusCopy";
import { EmptyState } from "@/components/dashboard/EmptyState";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  "single-family": "Single-family home",
  townhouse: "Townhouse",
  other: "Property",
};

/**
 * Read-only, customer-facing presentation of a single quote — the
 * foundation for a real "here's your estimate" link, not the finished
 * thing. It's reachable by anyone who has the URL: `quote.id` is an
 * unguessable-but-unauthenticated token, there is no check that the
 * visitor is actually this quote's customer. That's an acceptable
 * placeholder for a single-business prototype with no accounts yet, but
 * real access control (a signed link, or customer auth) belongs to a
 * later phase alongside real persistence — see
 * docs/decisions/0010-quote-creation-and-customer-view.md. Nothing here
 * lets a visitor change the quote; only the dashboard can do that.
 */
export default function CustomerQuotePage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0]! : params.id;

  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);

  useEffect(() => {
    queueMicrotask(() => setQuote(getQuote(id) ?? null));
  }, [id]);

  if (quote === undefined) return null;

  if (quote === null) {
    return (
      <EmptyState
        heading="We couldn't find this estimate."
        description="The link may be incorrect, or the estimate may no longer be available."
      />
    );
  }

  const display = getEstimateDisplay(quote.estimate);
  const selectedServices = [
    quote.servicePreferences.interiorCleaning && "Interior window cleaning",
    quote.servicePreferences.screens && "Screen cleaning",
    quote.servicePreferences.tracks && "Track cleaning",
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          {demoBusiness.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Estimate for {quote.customer.name || "you"}
        </h1>
        <p className="text-ink-soft">{QUOTE_STATUS_LABELS[quote.status]}</p>
      </div>

      <div className="rounded-2xl border border-line bg-paper-alt p-6">
        <p className="text-4xl font-semibold tracking-tight text-ink">
          {display.kind === "exact"
            ? `$${display.amount.toFixed(2)}`
            : `$${display.low}–$${display.high}`}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {PROPERTY_TYPE_LABELS[quote.property.propertyType] ?? "Property"} &middot;{" "}
          {quote.property.stories >= 3 ? "3+ stories" : `${quote.property.stories}-story`}
          {quote.property.address ? ` — ${quote.property.address}` : ""}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          What&rsquo;s included
        </p>
        <p className="text-sm text-ink-soft">
          {selectedServices.length > 0
            ? selectedServices.join(", ")
            : "Exterior window cleaning"}
        </p>
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm text-ink-soft">
          {quote.estimate.lineItems.map((item) => (
            <li key={item.label} className="flex justify-between gap-4">
              <span>{item.label}</span>
              <span className="font-mono">${item.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      {quote.notes ? (
        <div className="rounded-2xl border border-line bg-paper p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Notes</p>
          <p className="text-sm text-ink-soft">&ldquo;{quote.notes}&rdquo;</p>
        </div>
      ) : null}

      <p className="text-xs text-ink-faint">
        This is a prototype quote view — {demoBusiness.name} is a demo business, not a real Tallyvis
        customer, and no email or text message brought you here.
      </p>
    </div>
  );
}
