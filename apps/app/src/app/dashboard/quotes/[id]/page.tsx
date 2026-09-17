"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Quote, QuoteStatus, WindowCleaningCharacteristics } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import {
  getQuote,
  recalculateQuoteEstimate,
  updateQuoteAnalysis,
  updateQuoteStatus,
} from "@/lib/quotes/store";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { ConfidenceBadge } from "@/components/dashboard/ConfidenceBadge";
import { QuoteStatusBadge } from "@/components/dashboard/QuoteStatusBadge";
import { CharacteristicsEditor } from "@/components/dashboard/CharacteristicsEditor";
import { QuoteVisual } from "@/components/dashboard/QuoteVisual";
import { QuoteActions } from "@/components/dashboard/QuoteActions";
import { EmptyState } from "@/components/dashboard/EmptyState";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  "single-family": "Single-family home",
  townhouse: "Townhouse",
  other: "Other property",
};

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0]! : params.id;

  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setQuote(getQuote(id) ?? null));
  }, [id]);

  function refresh() {
    setQuote(getQuote(id) ?? null);
  }

  function handleSaveAnalysis(updated: WindowCleaningCharacteristics) {
    if (!quote) return;
    setPreviousTotal(quote.estimate.total);
    updateQuoteAnalysis(quote.id, updated);
    setIsEditing(false);
    setActionMessage(null);
    refresh();
  }

  function handleRecalculate() {
    if (!quote) return;
    setPreviousTotal(quote.estimate.total);
    recalculateQuoteEstimate(quote.id);
    setActionMessage(null);
    refresh();
  }

  function handleTransition(target: QuoteStatus) {
    if (!quote) return;
    updateQuoteStatus(quote.id, target);
    setActionMessage(target === "sent" ? "Estimate marked as sent." : null);
    refresh();
  }

  if (quote === undefined) return null;

  if (quote === null) {
    return (
      <EmptyState
        heading="Quote not found"
        description="This quote may have been removed."
        action={
          <Link href="/dashboard/quotes" className={buttonVariants({ variant: "outline" })}>
            Back to quotes
          </Link>
        }
      />
    );
  }

  const display = getEstimateDisplay(quote.estimate);
  const { characteristics, metadata } = quote.analysis;
  const estimateChanged = previousTotal !== null && previousTotal !== quote.estimate.total;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/quotes" className="w-fit text-sm text-ink-faint hover:text-ink">
          &larr; All quotes
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {quote.customer.name || "Unnamed customer"}
          </h1>
          <QuoteStatusBadge status={quote.status} />
        </div>
      </div>

      {actionMessage ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          {actionMessage}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Customer
          </p>
          <p className="text-sm font-medium text-ink">{quote.customer.name || "—"}</p>
          <p className="text-sm text-ink-soft">{quote.customer.email || "No email on file"}</p>
          {quote.customer.phone ? (
            <p className="text-sm text-ink-soft">{quote.customer.phone}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Property
          </p>
          <p className="text-sm font-medium text-ink">
            {PROPERTY_TYPE_LABELS[quote.property.propertyType]}
          </p>
          <p className="text-sm text-ink-soft">
            {quote.property.stories >= 3 ? "3+ stories" : `${quote.property.stories}-story`}
          </p>
          {quote.property.address ? (
            <p className="text-sm text-ink-soft">{quote.property.address}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Notes</p>
          <p className="text-sm text-ink-soft">
            {quote.notes ? `“${quote.notes}”` : "No additional notes."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Photos</p>
        {quote.photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {quote.photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- customer-submitted blob: preview, not an optimizable remote asset
              <img
                key={photo.id}
                src={photo.url}
                alt=""
                className="aspect-square rounded-lg border border-line object-cover"
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">
            No photos on file for this demo quote. Quotes submitted through the live estimator will
            show the customer&rsquo;s actual photos here.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-paper p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Tallyvis analysis
              </p>
              <ConfidenceBadge confidence={metadata.confidence} showHint />
            </div>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ["Windows", String(characteristics.windowCount)],
                ["Stories", String(characteristics.stories)],
                ["Screens", String(characteristics.screens)],
                [
                  "Window type",
                  characteristics.windowType[0]!.toUpperCase() +
                    characteristics.windowType.slice(1),
                ],
                [
                  "Access",
                  characteristics.accessibility[0]!.toUpperCase() +
                    characteristics.accessibility.slice(1),
                ],
                ["Est. labor", `~${characteristics.estimatedLaborHours} hr`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="text-sm font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {metadata.notes && metadata.notes.length > 0 ? (
              <p className="mt-4 border-t border-line pt-4 text-sm text-ink-soft">
                {metadata.notes[0]}
              </p>
            ) : null}
          </div>

          {isEditing ? (
            <CharacteristicsEditor
              initial={characteristics}
              onCancel={() => setIsEditing(false)}
              onSave={handleSaveAnalysis}
            />
          ) : null}

          <QuoteVisual characteristics={characteristics} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-paper-alt p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Estimate
              </p>
              {estimateChanged ? (
                <span className="text-xs text-accent-strong">
                  Updated — characteristics changed
                </span>
              ) : null}
            </div>
            <p className="text-3xl font-semibold tracking-tight text-ink">
              {display.kind === "exact"
                ? `$${display.amount.toFixed(2)}`
                : `$${display.low}–$${display.high}`}
            </p>
            {estimateChanged && previousTotal !== null ? (
              <p className="mt-1 text-sm text-ink-faint">Previously ${previousTotal.toFixed(2)}</p>
            ) : null}
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm text-ink-soft">
              {quote.estimate.lineItems.map((item) => (
                <li key={item.label} className="flex justify-between gap-4">
                  <span>{item.label}</span>
                  <span className="font-mono">${item.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Actions
            </p>
            <QuoteActions
              status={quote.status}
              onTransition={handleTransition}
              onEditAnalysis={() => setIsEditing((v) => !v)}
              onRecalculate={handleRecalculate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
