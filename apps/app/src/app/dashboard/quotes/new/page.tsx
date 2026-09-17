"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  Customer,
  Estimate,
  PricingConfiguration,
  PropertyType,
  ServicePreferences,
  TriState,
  WindowCleaningCharacteristics,
} from "@tallyvis/types";
import { calculateEstimate } from "@tallyvis/pricing";
import { buttonVariants } from "@tallyvis/ui";
import { createQuote, getPricingConfiguration } from "@/lib/quotes/store";
import { reconcilePricingInput } from "@/lib/pricingReconciliation";
import { windowCleaningEstimatorConfig } from "@/lib/estimator/industry-config";
import { OptionButton } from "@/components/OptionButton";
import { JobCharacteristicsFields } from "@/components/dashboard/JobCharacteristicsFields";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "single-family", label: "Single-family home" },
  { value: "townhouse", label: "Townhouse" },
  { value: "other", label: "Other" },
];

const STORY_OPTIONS = [1, 2, 3] as const;

const TRI_STATE_OPTIONS: { value: TriState; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

const TEXT_INPUT_CLASS =
  "rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

function emptyCustomer(): Customer {
  return { name: "", email: "", phone: "" };
}

function defaultCharacteristics(): WindowCleaningCharacteristics {
  return {
    vertical: "window-cleaning",
    windowCount: 20,
    windowType: "double-hung",
    paneCount: 0,
    stories: 1,
    screens: 0,
    tracks: 0,
    accessibility: "easy",
    condition: "good",
    hardWaterStaining: false,
    estimatedLaborHours: 2,
    interiorCleaning: false,
  };
}

function defaultServicePreferences(): ServicePreferences {
  return { interiorCleaning: false, screens: false, tracks: false, hardWaterTreatment: "unsure" };
}

function isValidEmail(email: string): boolean {
  return /\S+@\S+\.\S+/.test(email);
}

/**
 * The business-initiated counterpart to the customer's self-service
 * `/estimate/*` wizard — for when a business wants to create a quote
 * directly (over the phone, from a site visit) instead of waiting for the
 * customer to submit one. A single page rather than a multi-step wizard:
 * there's no photo upload or AI analysis step here, so nothing needs to be
 * split across routes. Prices exactly the way every other quote does, via
 * `calculateEstimate()` against the business's active pricing configuration.
 */
export default function NewQuotePage() {
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer>(emptyCustomer());
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null);
  const [stories, setStories] = useState<(typeof STORY_OPTIONS)[number] | null>(null);
  const [address, setAddress] = useState("");
  const [characteristics, setCharacteristics] = useState<WindowCleaningCharacteristics>(
    defaultCharacteristics(),
  );
  const [servicePreferences, setServicePreferences] = useState<ServicePreferences>(
    defaultServicePreferences(),
  );
  const [notes, setNotes] = useState("");
  const [configuration, setConfiguration] = useState<PricingConfiguration | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setConfiguration(getPricingConfiguration()));
  }, []);

  const propertyComplete = propertyType !== null && stories !== null;
  const customerComplete = customer.name.trim().length > 0 && isValidEmail(customer.email);
  const canSave = propertyComplete && customerComplete && configuration !== null;

  const effectiveCharacteristics: WindowCleaningCharacteristics = {
    ...characteristics,
    stories: stories ?? characteristics.stories,
  };

  let estimate: Estimate | null = null;
  let calculationError: string | null = null;
  if (configuration) {
    try {
      const pricingInput = reconcilePricingInput(servicePreferences, effectiveCharacteristics);
      estimate = calculateEstimate(pricingInput, configuration, "high");
    } catch (err) {
      calculationError = err instanceof Error ? err.message : "Could not calculate this estimate.";
    }
  }

  function handleSave() {
    if (!canSave || !configuration) return;
    try {
      const quote = createQuote({
        customer: {
          name: customer.name.trim(),
          email: customer.email.trim(),
          phone: customer.phone?.trim() || undefined,
        },
        property: {
          propertyType: propertyType!,
          stories: stories!,
          address: address.trim() || undefined,
        },
        servicePreferences,
        notes,
        photos: [],
        analysis: {
          characteristics: effectiveCharacteristics,
          // Entered directly by the business, not an AI guess — nothing to be
          // uncertain about, so this doesn't use the confidence-band display.
          metadata: { confidence: "high" },
        },
      });
      router.push(`/dashboard/quotes/${quote.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save this quote.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/quotes" className="w-fit text-sm text-ink-faint hover:text-ink">
          &larr; All quotes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">New quote</h1>
        <p className="text-ink-soft">
          Enter what you know about the customer and the job — Tallyvis prices it the same way it
          prices every estimate.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Customer</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="customer-name" className="text-sm font-medium text-ink">
                  Name
                </label>
                <input
                  id="customer-name"
                  type="text"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  placeholder="Jane Smith"
                  className={TEXT_INPUT_CLASS}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="customer-email" className="text-sm font-medium text-ink">
                  Email
                </label>
                <input
                  id="customer-email"
                  type="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  placeholder="jane@example.com"
                  className={TEXT_INPUT_CLASS}
                />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label htmlFor="customer-phone" className="text-sm font-medium text-ink">
                  Phone <span className="font-normal text-ink-faint">(optional)</span>
                </label>
                <input
                  id="customer-phone"
                  type="tel"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  placeholder="(555) 010-0110"
                  className={`${TEXT_INPUT_CLASS} sm:max-w-xs`}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Property</p>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-ink">Property type</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PROPERTY_TYPES.map((option) => (
                  <OptionButton
                    key={option.value}
                    selected={propertyType === option.value}
                    onClick={() => setPropertyType(option.value)}
                  >
                    {option.label}
                  </OptionButton>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-ink">Stories</legend>
              <div className="grid grid-cols-3 gap-2 sm:w-64">
                {STORY_OPTIONS.map((option) => (
                  <OptionButton
                    key={option}
                    selected={stories === option}
                    onClick={() => setStories(option)}
                  >
                    {option === 3 ? "3+" : option}
                  </OptionButton>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <label htmlFor="property-address" className="text-sm font-medium text-ink">
                Address <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input
                id="property-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, Springfield"
                className={TEXT_INPUT_CLASS}
              />
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                What&rsquo;s on the property
              </p>
              <p className="text-xs text-ink-faint">
                Job characteristics the estimate is priced from — the same fields Tallyvis&rsquo;s
                mock analyzer would produce from photos.
              </p>
            </div>
            <JobCharacteristicsFields
              value={effectiveCharacteristics}
              onChange={setCharacteristics}
              showStories={false}
            />
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              What the customer wants done
            </p>
            <div className="flex flex-col gap-5">
              {windowCleaningEstimatorConfig.serviceQuestions.map((question) => (
                <fieldset key={question.key} className="flex flex-col gap-2">
                  <legend className="text-sm font-medium text-ink">{question.label}</legend>
                  {question.helpText ? (
                    <p className="text-xs text-ink-faint">{question.helpText}</p>
                  ) : null}
                  <div className="flex gap-2">
                    {(
                      [
                        { value: true, label: "Yes" },
                        { value: false, label: "No" },
                      ] as const
                    ).map((option) => (
                      <OptionButton
                        key={String(option.value)}
                        selected={servicePreferences[question.key] === option.value}
                        onClick={() =>
                          setServicePreferences({ ...servicePreferences, [question.key]: option.value })
                        }
                      >
                        {option.label}
                      </OptionButton>
                    ))}
                  </div>
                </fieldset>
              ))}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-ink">Hard-water treatment</legend>
                <div className="flex gap-2">
                  {TRI_STATE_OPTIONS.map((option) => (
                    <OptionButton
                      key={option.value}
                      selected={servicePreferences.hardWaterTreatment === option.value}
                      onClick={() =>
                        setServicePreferences({ ...servicePreferences, hardWaterTreatment: option.value })
                      }
                    >
                      {option.label}
                    </OptionButton>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="notes" className="text-sm font-medium text-ink">
                Notes <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. gate code required, gutters also need attention"
                className={`resize-none ${TEXT_INPUT_CLASS}`}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl border border-line bg-paper-alt p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Estimate preview
            </p>
            {calculationError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {calculationError}
              </p>
            ) : estimate ? (
              <>
                <p className="text-3xl font-semibold tracking-tight text-ink">
                  ${estimate.total.toFixed(2)}
                </p>
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm text-ink-soft">
                  {estimate.lineItems.map((item) => (
                    <li key={item.label} className="flex justify-between gap-4">
                      <span>{item.label}</span>
                      <span className="font-mono">${item.amount.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                {configuration ? (
                  <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
                    Priced under pricing configuration version {configuration.version}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-faint">Loading pricing configuration&hellip;</p>
            )}
          </div>

          {saveError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {saveError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || !!calculationError}
            className={buttonVariants({ variant: "primary", className: "w-full" })}
          >
            Save quote
          </button>
          {!canSave ? (
            <p className="text-xs text-ink-faint">
              Add the customer&rsquo;s name and a valid email, and select a property type and story
              count, to save this quote.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
