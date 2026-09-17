"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { isContactComplete, isPropertyComplete } from "@/lib/estimator/types";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  "single-family": "Single-family home",
  townhouse: "Townhouse",
  other: "Other property",
};

function SummaryRow({
  label,
  editHref,
  children,
}: {
  label: string;
  editHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-b-0">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">{label}</p>
        <div className="text-sm text-ink">{children}</div>
      </div>
      <Link
        href={editHref}
        className="shrink-0 text-sm font-medium text-accent-strong hover:text-accent"
      >
        Edit
      </Link>
    </div>
  );
}

export default function ReviewStepPage() {
  const { input, updateContact } = useEstimator();
  const router = useRouter();

  useEffect(() => {
    if (!isPropertyComplete(input.property) || input.photos.length === 0) {
      router.replace("/estimate/property");
    }
  }, [input.property, input.photos.length, router]);

  const selectedServices = [
    input.services.interiorCleaning && "Interior window cleaning",
    input.services.screens && "Screen cleaning",
    input.services.tracks && "Track cleaning",
  ].filter(Boolean) as string[];

  const canAnalyze = isContactComplete(input.contact);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
          Step 4 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Review your request
        </h1>
        <p className="text-ink-soft">
          Make sure everything looks right before we analyze your property.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-paper px-6">
        <SummaryRow label="Your property" editHref="/estimate/property">
          {input.property.propertyType ? PROPERTY_TYPE_LABELS[input.property.propertyType] : "—"},{" "}
          {input.property.stories === 3 ? "3+ stories" : `${input.property.stories}-story`}
          {input.property.address ? (
            <span className="block text-ink-soft">{input.property.address}</span>
          ) : null}
        </SummaryRow>

        <SummaryRow label="Photos" editHref="/estimate/photos">
          {input.photos.length} uploaded
        </SummaryRow>

        <SummaryRow label="Services" editHref="/estimate/details">
          {selectedServices.length > 0 ? (
            <ul>
              {selectedServices.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            "Exterior window cleaning only"
          )}
          {input.services.hardWaterTreatment === "yes" ? (
            <span className="block text-ink-soft">Hard-water staining reported</span>
          ) : null}
        </SummaryRow>

        {input.notes ? (
          <SummaryRow label="Additional notes" editHref="/estimate/details">
            &ldquo;{input.notes}&rdquo;
          </SummaryRow>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6">
        <div>
          <p className="text-sm font-medium text-ink">Where should we send this?</p>
          <p className="text-xs text-ink-faint">
            So the business can follow up with your estimate.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="contact-name" className="text-sm font-medium text-ink">
              Name
            </label>
            <input
              id="contact-name"
              type="text"
              value={input.contact.name}
              onChange={(e) => updateContact({ name: e.target.value })}
              placeholder="Jane Smith"
              className="rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="contact-email" className="text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="contact-email"
              type="email"
              value={input.contact.email}
              onChange={(e) => updateContact({ email: e.target.value })}
              placeholder="jane@example.com"
              className="rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label htmlFor="contact-phone" className="text-sm font-medium text-ink">
              Phone <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              id="contact-phone"
              type="tel"
              value={input.contact.phone}
              onChange={(e) => updateContact({ phone: e.target.value })}
              placeholder="(555) 010-0110"
              className="rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong sm:max-w-xs"
            />
          </div>
        </div>
      </div>

      {canAnalyze ? (
        <Link
          href="/estimate/analyzing"
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          Analyze my property
        </Link>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled
            className={buttonVariants({ variant: "primary", className: "self-start" })}
          >
            Analyze my property
          </button>
          <p className="text-xs text-ink-faint">Add your name and a valid email to continue.</p>
        </div>
      )}
    </div>
  );
}
