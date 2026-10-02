"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerInput, PricingConfiguration, Quote, QuoteStatus, WindowCleaningCharacteristics } from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import type { JobOutcome, ObservationComparisonRow } from "@tallyvis/api";
import {
  recalculateQuoteEstimateAction,
  updateQuoteAnalysisAction,
  updateQuoteCustomerAction,
  updateQuoteStatusAction,
} from "@/lib/quoteActions";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import { formatQuoteNumber } from "@/lib/quoteNumber";
import { PROPERTY_TYPE_LABELS } from "@/lib/propertyTypeLabels";
import { ConfidenceBadge } from "@/components/dashboard/ConfidenceBadge";
import { QuoteStatusBadge } from "@/components/dashboard/QuoteStatusBadge";
import { CharacteristicsEditor } from "@/components/dashboard/CharacteristicsEditor";
import { CustomerEditor } from "@/components/dashboard/CustomerEditor";
import { QuoteVisual } from "@/components/dashboard/QuoteVisual";
import { QuotePhotoGallery } from "@/components/dashboard/QuotePhotoGallery";
import { QuoteActions } from "@/components/dashboard/QuoteActions";
import { ShareQuotePanel } from "@/components/dashboard/ShareQuotePanel";
import { JobOutcomePanel } from "@/components/dashboard/JobOutcomePanel";

/**
 * The single most important action for the mobile sticky action bar below
 * — mirrors `QuoteActions.tsx`'s own primary-variant entries (approve,
 * then send), in priority order, so the bar always surfaces whichever one
 * `canTransitionQuoteStatus` currently allows, or none at all (e.g. a
 * "sent" quote awaiting the customer's own response has no primary action
 * — only "Reject", which stays a deliberate, non-primary override,
 * available in the full desktop Actions card below).
 */
const QUOTE_PRIMARY_ACTIONS: { label: string; target: QuoteStatus }[] = [
  { label: "Approve estimate", target: "approved" },
  { label: "Send estimate", target: "sent" },
];

export interface QuoteDetailClientProps {
  initialQuote: Quote;
  initialPricingConfiguration: PricingConfiguration | undefined;
  initialJobOutcome: JobOutcome | undefined;
  observationComparison: ObservationComparisonRow[] | undefined;
}

/** Data is loaded server-side (see the page.tsx wrapping this) and passed in as props; every mutation below goes through a Server Action, which re-derives the business from the session — this component never decides ownership. */
export function QuoteDetailClient({
  initialQuote,
  initialPricingConfiguration,
  initialJobOutcome,
  observationComparison,
}: QuoteDetailClientProps) {
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
    const result = await updateQuoteAnalysisAction(quote.id, updated);
    if (result.ok) {
      setQuote(result.data);
      setIsEditing(false);
      setActionMessage(null);
    } else {
      setActionError(result.message);
    }
  }

  async function handleSaveCustomer(updated: CustomerInput) {
    setActionError(null);
    const result = await updateQuoteCustomerAction(quote.id, updated);
    if (result.ok) {
      setQuote(result.data);
      setIsEditingCustomer(false);
    } else {
      setActionError(result.message);
    }
  }

  async function handleRecalculate() {
    setPreviousTotal(quote.estimate.total);
    setActionError(null);
    const result = await recalculateQuoteEstimateAction(quote.id);
    if (result.ok) {
      setQuote(result.data.quote);
      setPricingConfiguration(result.data.pricingConfiguration);
      setActionMessage(null);
    } else {
      setActionError(result.message);
    }
  }

  async function handleTransition(target: QuoteStatus) {
    setActionError(null);
    const result = await updateQuoteStatusAction(quote.id, target);
    if (result.ok) {
      setQuote(result.data);
      setActionMessage(target === "sent" ? "Estimate marked as sent." : null);
    } else {
      setActionError(result.message);
    }
  }

  const display = getEstimateDisplay(quote.estimate);
  const { characteristics, metadata } = quote.analysis;
  const estimateChanged = previousTotal !== null && previousTotal !== quote.estimate.total;
  const displayAmount = display.kind === "exact" ? `$${display.amount.toFixed(2)}` : `$${display.low}–$${display.high}`;
  const submittedAt = new Date(quote.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const primaryAction = QUOTE_PRIMARY_ACTIONS.find((action) => canTransitionQuoteStatus(quote.status, action.target));

  return (
    <div className="flex flex-col gap-8 pb-20 lg:pb-0">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/quotes" className="w-fit text-sm text-ink-faint hover:text-ink">
          &larr; All quotes
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {quote.customer.name || "Unnamed customer"}
            </h1>
            <p className="text-xs text-ink-faint">Quote #{formatQuoteNumber(quote.id)}</p>
          </div>
          <div className="flex items-center gap-3">
            <QuoteStatusBadge status={quote.status} />
          </div>
        </div>
      </div>

      {/*
        Mobile-first "at a glance" summary (lg:hidden — the 3-column grid
        just below already shows this on wider screens where there's room
        to spare). This is the whole point of the SMS→tap→login→"see
        customer/job info" path: everything a business owner needs to
        decide whether to call or approve, scannable with zero scrolling,
        with real tel:/mailto: links instead of plain text.
      */}
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-5 lg:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <QuoteStatusBadge status={quote.status} />
          <ConfidenceBadge confidence={metadata.confidence} showHint />
        </div>
        <p className="text-sm text-ink-soft">{quote.property.address || "No address on file"}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {quote.customer.phone ? (
            <a href={`tel:${quote.customer.phone}`} className="font-medium text-accent-strong hover:text-accent">
              {quote.customer.phone}
            </a>
          ) : null}
          {quote.customer.email ? (
            <a href={`mailto:${quote.customer.email}`} className="font-medium text-accent-strong hover:text-accent">
              {quote.customer.email}
            </a>
          ) : null}
        </div>
        <p className="text-2xl font-semibold tracking-tight text-ink">{displayAmount}</p>
        <p className="text-xs text-ink-faint">Submitted {submittedAt}</p>
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
          {quote.customer.email ? (
            <a href={`mailto:${quote.customer.email}`} className="block text-sm text-accent-strong hover:text-accent">
              {quote.customer.email}
            </a>
          ) : (
            <p className="text-sm text-ink-soft">No email on file</p>
          )}
          {quote.customer.phone ? (
            <a href={`tel:${quote.customer.phone}`} className="block text-sm text-accent-strong hover:text-accent">
              {quote.customer.phone}
            </a>
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
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Customer photos</p>
        <QuotePhotoGallery quoteId={quote.id} photos={quote.photos} />
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

          <ShareQuotePanel quote={quote} />

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

          <JobOutcomePanel
            quoteId={quote.id}
            estimateTotal={quote.estimate.total}
            estimatedLaborHours={characteristics.estimatedLaborHours}
            initialOutcome={initialJobOutcome}
            observationComparison={observationComparison}
          />
        </div>
      </div>

      {/*
        Sticky mobile-only action bar (hidden at lg: and up, where the full
        Actions card above is already comfortably reachable without
        scrolling past much). Keeps the single most important action — and
        a one-tap call to the customer — available without hunting through
        the AI-analysis/photos content above on a phone. `pb-20 lg:pb-0` on
        the page's outer wrapper reserves room so this bar never overlaps
        the JobOutcomePanel's own bottom content.
      */}
      {primaryAction || quote.customer.phone ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-line bg-paper px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] lg:hidden">
          {quote.customer.phone ? (
            <a
              href={`tel:${quote.customer.phone}`}
              aria-label="Call customer"
              className={buttonVariants({ variant: "outline", className: "shrink-0 px-4" })}
            >
              Call
            </a>
          ) : null}
          {primaryAction ? (
            <button
              type="button"
              onClick={() => handleTransition(primaryAction.target)}
              className={buttonVariants({ variant: "primary", className: "flex-1" })}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
