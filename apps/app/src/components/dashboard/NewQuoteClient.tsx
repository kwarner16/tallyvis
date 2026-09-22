"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CustomerInput,
  Estimate,
  PricingConfiguration,
  PropertyType,
  ServicePreferences,
  TriState,
  WindowCleaningCharacteristics,
} from "@tallyvis/types";
import type { RawPropertyObservation } from "@tallyvis/api";
import { calculateEstimate, reconcilePricingInput } from "@tallyvis/pricing";
import { buttonVariants } from "@tallyvis/ui";
import { analyzePropertyAction, createQuoteAction } from "@/lib/quoteActions";
import { windowCleaningEstimatorConfig } from "@/lib/estimator/industry-config";
import { fileToDataUrl } from "@/lib/imageEncoding";
import { AI_UNAVAILABLE_CONTINUE_MANUALLY } from "@/lib/aiErrorMessages";
import { defaultWindowCleaningCharacteristics } from "@/lib/defaultCharacteristics";
import { OptionButton } from "@/components/OptionButton";
import { JobCharacteristicsFields } from "@/components/dashboard/JobCharacteristicsFields";
import { AiObservationSummary } from "@/components/dashboard/AiObservationSummary";

const MAX_ANALYSIS_PHOTOS = 8;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface AnalysisPhoto {
  id: string;
  name: string;
  dataUrl: string;
}

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

function emptyCustomer(): CustomerInput {
  return { name: "", email: "", phone: "" };
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
 * customer to submit one. A single page rather than a multi-step wizard —
 * even with Phase 11's optional AI-assisted photo analysis (see
 * docs/decisions/0013-ai-analysis-foundation.md), there's no separate
 * "analyzing"/"result" route the way the customer wizard has; analysis
 * happens inline and pre-fills the same editable fields below it, rather
 * than gating the page behind it. The live preview below calls
 * `calculateEstimate()` client-side against the active configuration
 * (loaded server-side, see the page wrapping this) purely for instant
 * feedback — saving always goes through `createQuoteAction`, which
 * recomputes the estimate server-side from scratch and never trusts this
 * preview's numbers, or anything the AI analysis step suggested directly.
 */
export function NewQuoteClient({ configuration }: { configuration: PricingConfiguration }) {
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerInput>(emptyCustomer());
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null);
  const [stories, setStories] = useState<(typeof STORY_OPTIONS)[number] | null>(null);
  const [address, setAddress] = useState("");
  const [characteristics, setCharacteristics] = useState<WindowCleaningCharacteristics>(
    defaultWindowCleaningCharacteristics(),
  );
  const [servicePreferences, setServicePreferences] = useState<ServicePreferences>(
    defaultServicePreferences(),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [analysisPhotos, setAnalysisPhotos] = useState<AnalysisPhoto[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [observation, setObservation] = useState<RawPropertyObservation | null>(null);
  /**
   * What the AI suggested but the business hasn't applied yet — kept
   * separate from `characteristics`/`stories` so a fresh "Analyze with AI"
   * run never silently overwrites a value the business already typed or
   * corrected (Phase 12, docs/decisions/0014-ai-real-world-refinement.md:
   * human correction is authoritative). Applying is always an explicit
   * click, both the first time and on every re-run.
   */
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    characteristics: WindowCleaningCharacteristics;
    stories: (typeof STORY_OPTIONS)[number];
  } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const propertyComplete = propertyType !== null && stories !== null && address.trim().length > 0;
  const customerComplete = customer.name.trim().length > 0 && isValidEmail(customer.email);
  const canSave = propertyComplete && customerComplete;

  const effectiveCharacteristics: WindowCleaningCharacteristics = {
    ...characteristics,
    stories: stories ?? characteristics.stories,
  };

  let estimate: Estimate | null = null;
  let calculationError: string | null = null;
  try {
    const pricingInput = reconcilePricingInput(servicePreferences, effectiveCharacteristics);
    estimate = calculateEstimate(pricingInput, configuration, "high");
  } catch (err) {
    calculationError = err instanceof Error ? err.message : "Could not calculate this estimate.";
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const quote = await createQuoteAction({
        customer: {
          name: customer.name.trim(),
          email: customer.email.trim(),
          phone: customer.phone?.trim() || undefined,
        },
        property: {
          propertyType: propertyType!,
          stories: stories!,
          address: address.trim(),
        },
        servicePreferences,
        notes,
        photos: [],
        analysis: {
          characteristics: effectiveCharacteristics,
          // Whatever is on screen when "Save quote" is clicked — whether typed
          // directly or pre-filled by AI analysis below — has been reviewed
          // and (implicitly, by saving) confirmed by the business, so this
          // is recorded as a confident, human-backed value either way. AI
          // uncertainty never reaches the saved quote un-reviewed.
          metadata: { confidence: "high" },
        },
        // Preserved alongside the quote for later comparison against
        // whatever's actually confirmed above (Phase 13 — see
        // docs/decisions/0015-job-outcome-tracking.md) — `undefined` when
        // AI was never used for this quote, never fabricated after the
        // fact. Reflects the most recent analysis result regardless of
        // whether "Apply to form" was clicked: even a suggestion the
        // business looked at and typed over is a genuine AI-observed vs.
        // human-confirmed data point.
        aiObservation: observation ?? undefined,
      });
      router.push(`/dashboard/quotes/${quote.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save this quote.");
      setSaving(false);
    }
  }

  async function handleAddPhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setAnalyzeError(null);
    const remainingSlots = MAX_ANALYSIS_PHOTOS - analysisPhotos.length;
    const accepted: AnalysisPhoto[] = [];

    for (const file of Array.from(fileList).slice(0, remainingSlots)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_PHOTO_BYTES) {
        setAnalyzeError(`${file.name} is larger than 10 MB and was skipped.`);
        continue;
      }
      accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, dataUrl: await fileToDataUrl(file) });
    }

    if (accepted.length > 0) setAnalysisPhotos((prev) => [...prev, ...accepted]);
  }

  function handleRemovePhoto(id: string) {
    setAnalysisPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleAnalyze() {
    if (analysisPhotos.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { analysis, observation: newObservation } = await analyzePropertyAction({
        images: analysisPhotos.map((p) => ({ url: p.dataUrl })),
        property: { stories: stories ?? undefined, address: address.trim() || undefined },
      });
      setObservation(newObservation);
      // Never applied automatically — see `pendingSuggestion`'s comment.
      setPendingSuggestion({
        characteristics: analysis.characteristics,
        stories: analysis.characteristics.stories as (typeof STORY_OPTIONS)[number],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not analyze these photos.";
      setAnalyzeError(`${message} ${AI_UNAVAILABLE_CONTINUE_MANUALLY}`);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleApplySuggestion() {
    if (!pendingSuggestion) return;
    setCharacteristics(pendingSuggestion.characteristics);
    setStories(pendingSuggestion.stories);
    setPendingSuggestion(null);
  }

  function handleDiscardSuggestion() {
    setPendingSuggestion(null);
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
                Service address <span className="font-normal text-red-600">*</span>
              </label>
              <p className="text-xs text-ink-faint">Where will the service be performed?</p>
              <input
                id="property-address"
                type="text"
                required
                autoComplete="street-address"
                aria-required="true"
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
                Analyze from photos <span className="font-normal normal-case text-ink-faint">(optional)</span>
              </p>
              <p className="text-xs text-ink-faint">
                Upload photos of the property and Tallyvis will suggest the fields below — you always
                review and confirm before saving. AI never sets the price directly.
              </p>
            </div>

            {analysisPhotos.length > 0 ? (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {analysisPhotos.map((photo) => (
                  <li key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- locally-read data: URI, not a remote/optimizable asset */}
                    <img src={photo.dataUrl} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(photo.id)}
                      aria-label={`Remove photo ${photo.name}`}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-paper opacity-90 transition-opacity hover:bg-ink focus-visible:opacity-100"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void handleAddPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={analysisPhotos.length >= MAX_ANALYSIS_PHOTOS}
                className={buttonVariants({ variant: "outline" })}
              >
                {analysisPhotos.length >= MAX_ANALYSIS_PHOTOS ? "Maximum photos added" : "Add photos"}
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analysisPhotos.length === 0 || analyzing}
                className={buttonVariants({ variant: "primary" })}
              >
                {analyzing ? "Analyzing…" : "Analyze with AI"}
              </button>
            </div>

            {analyzeError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{analyzeError}</p>
            ) : null}

            {observation ? (
              <div className="flex flex-col gap-3">
                <AiObservationSummary observation={observation} />
                {pendingSuggestion ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent bg-accent-soft/60 px-4 py-3">
                    <p className="text-sm text-accent-strong">
                      This suggestion hasn&rsquo;t been applied to the form below yet.
                    </p>
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={handleDiscardSuggestion}
                        className={buttonVariants({ variant: "outline" })}
                      >
                        Keep current values
                      </button>
                      <button
                        type="button"
                        onClick={handleApplySuggestion}
                        className={buttonVariants({ variant: "primary" })}
                      >
                        Apply to form
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint">Applied to the form below.</p>
                )}
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                What&rsquo;s on the property
              </p>
              <p className="text-xs text-ink-faint">
                Job characteristics the estimate is priced from — filled in above by AI analysis if you
                used it, or enter them directly.
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
                <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
                  Priced under pricing configuration version {configuration.version}.
                </p>
              </>
            ) : null}
          </div>

          {saveError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {saveError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || !!calculationError || saving}
            className={buttonVariants({ variant: "primary", className: "w-full" })}
          >
            {saving ? "Saving…" : "Save quote"}
          </button>
          {!canSave ? (
            <p className="text-xs text-ink-faint">
              Add the customer&rsquo;s name and a valid email, and select a property type, story
              count, and service address, to save this quote.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
