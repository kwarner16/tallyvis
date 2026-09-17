"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerInput, PricingConfiguration, Quote, QuoteStatus, WindowCleaningCharacteristics } from "@tallyvis/types";
import {
  recalculateQuoteEstimateAction,
  updateQuoteAnalysisAction,
  updateQuoteCustomerAction,
  updateQuoteStatusAction,
} from "@/lib/quoteActions";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { ConfidenceBadge } from "@/components/dashboard/ConfidenceBadge";
import { QuoteStatusBadge } from "@/components/dashboard/QuoteStatusBadge";
import { CharacteristicsEditor } from "@/components/dashboard/CharacteristicsEditor";
import { CustomerEditor } from "@/components/dashboard/CustomerEditor";
import { QuoteVisual } from "@/components/dashboard/QuoteVisual";
import { QuoteActions } from "@/components/dashboard/QuoteActions";

function quoteNumber(id: string): string {
  return id.split("_").pop()?.slice(0, 8).toUpperCase() ?? id;
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  "single-family": "Single-family home",
  townhouse: "Townhouse",
  other: "Other property",
};

export interface QuoteDetailClientProps {
  initialQuote: Quote;
  initialPricingConfiguration: PricingConfiguration | undefined;
}

/** Data is loaded server-side (see the page.tsx wrapping this) and passed in as props; every mutation below goes through a Server Action, which re-derives the business from the session — this component never decides ownership. */
export function QuoteDetailClient({ initialQuote, initialPricingConfiguration }: QuoteDetailClientProps) {
  const [quote, setQuote] = useState(initialQuote);
  const [pricingConfiguration, setPricingConfiguration] = useState(initialPricingConfiguration);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSaveAnalysis(updated: WindowCleaningCharacteristics) {
    setPreviousTotal(quote.estimate.total);
    setActionError(null);
    try {
      const next = await updateQuoteAnalysisAction(quote.id, updated);
      setQuote(next);
      setIsEditing(false);
      setActionMessage(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save this change.");
    }
  }

  async function handleSaveCustomer(updated: CustomerInput) {
    setActionError(null);
    try {
      const next = await updateQuoteCustomerAction(quote.id, updated);
      setQuote(next);
      setIsEditingCustomer(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save this change.");
    }
  }

  async function handleRecalculate() {
    setPreviousTotal(quote.estimate.total);
    setActionError(null);
    try {
      const { quote: next, pricingConfiguration: nextConfiguration } =
        await recalculateQuoteEstimateAction(quote.id);
      setQuote(next);
      setPricingConfiguration(nextConfiguration);
      setActionMessage(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not recalculate this quote.");
    }
  }

  async function handleTransition(target: QuoteStatus) {
    setActionError(null);
    try {
      const next = await updateQuoteStatusAction(quote.id, target);
      setQuote(next);
      setActionMessage(target === "sent" ? "Estimate marked as sent." : null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update this quote's status.");
    }
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {quote.customer.name || "Unnamed customer"}
            </h1>
            <p className="text-xs text-ink-faint">Quote #{quoteNumber(quote.id)}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/quote/${quote.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-accent-strong hover:text-accent"
            >
              View as customer &#8599;
            </Link>
            <QuoteStatusBadge status={quote.status} />
          </div>
        </div>
      </div>

      {actionMessage ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          {actionMessage}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-paper p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Customer</p>
            {!isEditingCustomer ? (
              <button
                type="button"
                onClick={() => setIsEditingCustomer(true)}
                className="text-xs font-medium text-accent-strong hover:text-accent"
              >
                Edit
              </button>
            ) : null}
          </div>
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

      {isEditingCustomer ? (
        <CustomerEditor
          initial={quote.customer}
          onCancel={() => setIsEditingCustomer(false)}
          onSave={handleSaveCustomer}
        />
      ) : null}

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
            No photos on file for this quote. Quotes submitted through the live estimator will show
            the customer&rsquo;s actual photos here.
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
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
              {pricingConfiguration
                ? `Priced under pricing configuration version ${pricingConfiguration.version}.`
                : "The pricing configuration used for this quote is no longer available."}
            </p>
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
