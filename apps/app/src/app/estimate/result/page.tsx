"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Business, Estimate } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { reconcilePricingInput, calculateEstimate } from "@tallyvis/pricing";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { getEstimateDisplay } from "@/lib/estimateDisplay";
import {
  createPublicQuoteAction,
  getPublicActiveConfigurationAction,
  getPublicBusinessAction,
} from "@/lib/publicActions";
import { CONTACT_URL } from "@/lib/urls";

export default function ResultStepPage() {
  const { analysis, aiObservation, input, quoteId, embedId, setQuoteId, reset } = useEstimator();
  const router = useRouter();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [requested, setRequested] = useState(false);
  const [business, setBusiness] = useState<Business | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const hasCreatedQuote = useRef(false);

  useEffect(() => {
    if (!analysis) {
      router.replace("/estimate/property");
    }
  }, [analysis, router]);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    Promise.all([
      getPublicBusinessAction(embedId ?? undefined),
      getPublicActiveConfigurationAction(embedId ?? undefined),
    ]).then(
      ([loadedBusiness, configuration]) => {
        if (cancelled) return;
        setBusiness(loadedBusiness);
        const pricingInput = reconcilePricingInput(input.services, analysis.characteristics);
        setEstimate(calculateEstimate(pricingInput, configuration, analysis.metadata.confidence));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  // Every completed analysis becomes a quote the business can see, whether
  // or not the customer goes on to click "Request this service" — see
  // docs/decisions/0008-quote-domain-model.md.
  useEffect(() => {
    if (!analysis || quoteId || hasCreatedQuote.current) return;
    hasCreatedQuote.current = true;
    createPublicQuoteAction(
      {
        customer: {
          name: input.contact.name,
          email: input.contact.email,
          phone: input.contact.phone || undefined,
        },
        property: {
          propertyType: input.property.propertyType!,
          stories: input.property.stories!,
          address: input.property.address || undefined,
        },
        servicePreferences: input.services,
        notes: input.notes,
        photos: input.photos.map((p) => ({ id: p.id, url: p.previewUrl })),
        analysis,
        aiObservation: aiObservation ?? undefined,
      },
      embedId ?? undefined,
    ).then(({ id }) => setQuoteId(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  if (!analysis || !estimate || !business) return null;

  const display = getEstimateDisplay(estimate);
  const { characteristics, metadata } = analysis;
  const needsMoreInfo = metadata.confidence === "low";

  if (requested) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent-strong"
        >
          &#10003;
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-ink">Your request has been received.</h1>
          <p className="max-w-sm text-sm text-ink-soft">
            Someone from {business.name} can follow up with you about next steps.
          </p>
        </div>
        <p className="max-w-sm text-xs text-ink-faint">
          This is a prototype confirmation — no email or text message delivery exists yet, so
          nothing was actually sent.
        </p>
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
      </div>
    );
  }

  // Phase 14 branding (see docs/decisions/0016-onboarding-billing-embed.md)
  // — a single CSS custom-property override, not a theme system.
  const brandStyle =
    business.brandColor && /^#[0-9a-fA-F]{6}$/.test(business.brandColor)
      ? ({ "--color-accent-strong": business.brandColor } as React.CSSProperties)
      : undefined;

  return (
    <div className="flex flex-col gap-8" style={brandStyle}>
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
          <p className="text-sm text-ink-soft">
            {metadata.notes?.[0] ??
              "We couldn't confidently determine every detail from the photos provided."}
          </p>
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
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button
          type="button"
          onClick={() => setRequested(true)}
          className={buttonVariants({ variant: "primary" })}
        >
          Request this service
        </button>
        <a href={CONTACT_URL} className={buttonVariants({ variant: "outline" })}>
          Talk to the business
        </a>
      </div>
    </div>
  );
}
