"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Estimate, PropertyAnalysisResult } from "@tallyvis/types";
import type { PublicBusinessSummary } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { reconcilePricingInput, calculateEstimate } from "@tallyvis/pricing";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import {
  createPublicQuoteAction,
  updatePublicQuoteAction,
  getPublicActiveConfigurationAction,
  getPublicBusinessAction,
} from "@/lib/publicActions";
import { CONTACT_URL, MARKETING_URL } from "@/lib/urls";

export default function ResultStepPage() {
  const { analysis, aiObservation, evidenceMessages, confirmed, input, quoteId, embedId, setQuoteId, reset } =
    useEstimator();
  const router = useRouter();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [requested, setRequested] = useState(false);
  const [business, setBusiness] = useState<PublicBusinessSummary | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  /** Distinct from `analysisError` (the earlier /estimate/analyzing step) — this can fail even for the manual-entry path, which never goes through that step at all. Without this, a rejected promise here previously just left the page spinning forever with no feedback. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quoteSaveFailed, setQuoteSaveFailed] = useState(false);
  /**
   * Tracks the exact `analysis` object last submitted (created or
   * updated) — NOT just a boolean "have we ever created one" — so a
   * re-analysis (the customer went back to add another photo, producing a
   * genuinely new `analysis` reference) is recognized as something to
   * submit again, while a re-render with the SAME analysis (including
   * React strict-mode's double effect invocation) is still a no-op.
   * Replaces the previous plain `hasCreatedQuote` boolean, which had no
   * way to distinguish those two cases and silently discarded every
   * re-analysis once the first quote existed (2026-09 incident audit).
   */
  const lastSubmittedAnalysis = useRef<PropertyAnalysisResult | null>(null);

  useEffect(() => {
    if (!analysis) {
      router.replace("/estimate/property");
      return;
    }
    // Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
    // — an AI-derived analysis must go through /estimate/confirm first; a
    // manually-entered one (no aiObservation) never needed to. Catches a
    // direct/back-button navigation here that skipped confirmation, not
    // the normal flow (which already routes through /estimate/confirm).
    if (aiObservation && !confirmed) {
      router.replace("/estimate/confirm");
    }
  }, [analysis, aiObservation, confirmed, router]);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    Promise.all([
      getPublicBusinessAction(embedId ?? undefined),
      getPublicActiveConfigurationAction(embedId ?? undefined),
    ]).then(([businessResult, configResult]) => {
      if (cancelled) return;
      if (!businessResult.ok) {
        setLoadError(businessResult.message);
        return;
      }
      if (!configResult.ok) {
        setLoadError(configResult.message);
        return;
      }
      setBusiness(businessResult.data);
      const pricingInput = reconcilePricingInput(input.services, analysis.characteristics);
      setEstimate(calculateEstimate(pricingInput, configResult.data, analysis.metadata.confidence));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  // Every completed analysis becomes a quote the business can see, whether
  // or not the customer goes on to click "Request this service" — see
  // docs/decisions/0008-quote-domain-model.md. If the customer goes BACK
  // to add another photo (e.g. from the "Add another photo" link below)
  // and returns here with a genuinely new `analysis`, this UPDATES the
  // same quote instead of silently discarding the improvement — see
  // `updatePublicQuoteAction`'s own comment (2026-09 incident audit: the
  // business was previously stuck seeing only the first, worse-evidence
  // submission, forever).
  //
  // Never attempted at all without a real `embedId` (the direct,
  // un-embedded `/estimate` demo — see
  // docs/decisions/0027-direct-estimator-demo-mode.md): there is no real
  // business to notify, and `createPublicQuoteAction`/`updatePublicQuoteAction`
  // both refuse outright in that case anyway. Skipping the call here (not
  // just relying on that refusal) avoids a wasted round trip and keeps
  // `quoteSaveFailed` meaning exactly one thing — a REAL, unexpected save
  // failure for an embedded session — never "this was always a demo."
  useEffect(() => {
    if (!analysis || !embedId || lastSubmittedAnalysis.current === analysis) return;
    lastSubmittedAnalysis.current = analysis;
    const payload = {
      customer: {
        name: input.contact.name,
        email: input.contact.email,
        phone: input.contact.phone || undefined,
      },
      property: {
        propertyType: input.property.propertyType!,
        stories: input.property.stories!,
        address: input.property.address.trim(),
      },
      servicePreferences: input.services,
      notes: input.notes,
      photos: input.photos.map((p) => ({ id: p.id, url: p.previewUrl })),
      analysis,
      aiObservation: aiObservation ?? undefined,
    };
    const action = quoteId
      ? updatePublicQuoteAction(quoteId, payload, embedId ?? undefined)
      : createPublicQuoteAction(payload, embedId ?? undefined);
    action.then((result) => {
      if (result.ok) {
        setQuoteId(result.data.id);
        setQuoteSaveFailed(false);
        return;
      }
      // The customer still sees their price either way (that's the whole
      // point of showing it from client-side pricing above, not waiting on
      // this) — only the business-visible record failed to save. Surfaced
      // as a small non-blocking notice below, not a page-level failure.
      setQuoteSaveFailed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  if (!analysis) return null;

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-xl font-semibold text-accent-strong"
        >
          !
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">This estimator isn&rsquo;t available</h1>
          <p className="mt-2 max-w-xs text-sm text-ink-soft">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!estimate || !business) return null;

  const display = getEstimateDisplay(estimate);
  const { characteristics, metadata } = analysis;
  const needsMoreInfo = metadata.confidence === "low";
  // Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
  // — specific, actionable gaps computed server-side (see
  // `analyzePublicPropertyAction`'s own comment for why this is plain
  // strings from context, not a client-side `describeEvidenceGaps` call),
  // when any exist. Falls back to the previous generic first-note
  // behavior otherwise, so the manual-entry path is unaffected.
  const moreInfoMessages =
    evidenceMessages.length > 0
      ? evidenceMessages
      : [metadata.notes?.[0] ?? "We couldn't confidently determine every detail from the photos provided."];

  if (requested) {
    // Demo mode (no real embedId — docs/decisions/0027) never sent a real
    // request to a real business; the confirmation screen says so
    // explicitly rather than implying "someone" will follow up, per
    // CLAUDE.md's mock/demo-labeling requirement.
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent-strong"
        >
          &#10003;
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-ink">
            {embedId ? "Your request has been received." : "That's the full experience."}
          </h1>
          <p className="max-w-sm text-sm text-ink-soft">
            {embedId
              ? `Someone from ${business.name} can follow up with you about next steps.`
              : "This was a preview — no request was sent to any business. Sign up your own business to start receiving real customer requests like this one."}
          </p>
        </div>
        {embedId ? (
          <p className="max-w-sm text-xs text-ink-faint">
            This is a prototype confirmation — no email or text message delivery exists yet, so
            nothing was actually sent.
          </p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              reset();
              router.push("/estimate");
            }}
            className={buttonVariants({ variant: "outline" })}
          >
            Start a new estimate
          </button>
          {embedId ? null : (
            <Link href="/signup" className={buttonVariants({ variant: "primary" })}>
              Sign up your business
            </Link>
          )}
        </div>
      </div>
    );
  }

  // The full brand theme (buttons, focus rings, progress indicator, links)
  // is applied once, for every /estimate/* step, by StepShell — see
  // useEstimatorBrandTheme there. Nothing left to apply here.
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary business-hosted URL, not an optimizable local/remote asset Next.js knows about
          <img src={business.logoUrl} alt={business.name} className="h-8 w-auto object-contain" />
        ) : null}
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          {business.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Your estimate
        </h1>
      </div>

      {needsMoreInfo ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-accent bg-accent-soft p-5">
          <p className="text-sm font-semibold text-accent-strong">
            We need a little more information
          </p>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-soft">
            {moreInfoMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <Link
            href="/estimate/photos"
            className={buttonVariants({ variant: "outline", className: "self-start" })}
          >
            Add another photo
          </Link>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-paper-alt p-6">
        <p className="text-4xl font-semibold tracking-tight text-ink">
          {display.kind === "exact"
            ? `$${display.amount.toFixed(2)}`
            : `$${display.low}–$${display.high}`}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Based on your property and the services selected.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-6 sm:grid-cols-3">
          {[
            ["Windows", String(characteristics.windowCount)],
            ["Stories", String(characteristics.stories)],
            characteristics.screens > 0 ? ["Screens", String(characteristics.screens)] : null,
            ["Type", "Double-hung"],
            [
              "Access",
              characteristics.accessibility[0]!.toUpperCase() +
                characteristics.accessibility.slice(1),
            ],
            ["Est. labor", `~${characteristics.estimatedLaborHours} hr`],
          ]
            .filter((row): row is [string, string] => row !== null)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="text-sm font-medium text-ink">{value}</dd>
              </div>
            ))}
        </dl>
      </div>

      <details
        open={showBreakdown}
        onToggle={(e) => setShowBreakdown(e.currentTarget.open)}
        className="rounded-xl border border-line px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-medium text-ink-soft">
          See how we calculated this
        </summary>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink-soft">
          {estimate.lineItems.map((item) => (
            <li key={item.label} className="flex justify-between gap-4">
              <span>{item.label}</span>
              <span className="font-mono">${item.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-col gap-2 text-xs text-ink-faint">
        <p>Your estimate is based on the photos and information you provided.</p>
        <p>
          Final pricing may change if the actual property differs significantly from what was
          submitted.
        </p>
        {quoteSaveFailed ? (
          <p className="text-accent-strong">
            We couldn&rsquo;t save this request for {business.name} to follow up on automatically —
            please use &ldquo;Talk to the business&rdquo; below instead.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button
          type="button"
          onClick={() => setRequested(true)}
          className={buttonVariants({ variant: "primary" })}
        >
          {embedId ? "Request this service" : "See what happens next"}
        </button>
        {embedId ? (
          <a href={CONTACT_URL} className={buttonVariants({ variant: "outline" })}>
            Talk to the business
          </a>
        ) : (
          <a href={MARKETING_URL} className={buttonVariants({ variant: "outline" })}>
            Learn more about Tallyvis
          </a>
        )}
      </div>
    </div>
  );
}
