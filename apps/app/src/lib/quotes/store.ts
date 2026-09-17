import type {
  Customer,
  PricingConfiguration,
  Property,
  PropertyAnalysisResult,
  Quote,
  QuoteStatus,
  ServicePreferences,
  WindowCleaningCharacteristics,
  WindowCleaningPricingRules,
} from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import { calculateEstimate } from "@tallyvis/pricing";
import { demoBusiness, demoPricingConfiguration } from "@tallyvis/config";
import { reconcilePricingInput } from "../pricingReconciliation";
import { seedQuotes } from "./seedQuotes";

/**
 * Mock persistence for the business dashboard — localStorage-backed, the
 * single location holding this app's quote/pricing state. This is the
 * boundary that becomes services/api once a real backend exists; see
 * docs/decisions/0008-quote-domain-model.md. Browser-only (every export
 * checks for `window`) since nothing here needs to run server-side yet.
 */

const STORAGE_KEY = "tallyvis-dashboard-v1";

export interface BusinessSettings {
  name: string;
  email: string;
  phone: string;
  serviceArea: string;
  defaultIndustry: "window-cleaning";
}

interface DashboardData {
  /**
   * Every pricing configuration version this business has ever saved,
   * oldest first — see docs/decisions/0009-pricing-configuration-versioning.md.
   * The last entry is the active one; earlier entries are kept so quotes
   * pinned to an older `pricingConfigId` can still be looked up.
   */
  pricingConfigurations: PricingConfiguration[];
  quotes: Quote[];
  settings: BusinessSettings;
}

function defaultData(): DashboardData {
  return {
    pricingConfigurations: [demoPricingConfiguration],
    quotes: seedQuotes(),
    settings: {
      name: demoBusiness.name,
      email: "hello@demowindowcleaning.example",
      phone: "(555) 010-0110",
      serviceArea: "Greater Springfield area",
      defaultIndustry: "window-cleaning",
    },
  };
}

function loadData(): DashboardData {
  if (typeof window === "undefined") return defaultData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw) as DashboardData;
    // Defensive against a stale shape from an earlier version of this store.
    if (
      !Array.isArray(parsed.pricingConfigurations) ||
      parsed.pricingConfigurations.length === 0 ||
      !Array.isArray(parsed.quotes) ||
      !parsed.settings
    ) {
      return defaultData();
    }
    return parsed;
  } catch {
    return defaultData();
  }
}

function saveData(data: DashboardData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private browsing, quota) — not fatal for a demo.
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- pricing --

/** The active pricing configuration — the highest version this business has saved. */
function activePricingConfiguration(data: DashboardData): PricingConfiguration {
  return data.pricingConfigurations[data.pricingConfigurations.length - 1]!;
}

function findPricingConfiguration(data: DashboardData, id: string): PricingConfiguration {
  const configuration = data.pricingConfigurations.find((c) => c.id === id);
  if (!configuration) throw new Error(`Pricing configuration "${id}" not found.`);
  return configuration;
}

/** The business's current pricing configuration — what new quotes are priced and pinned against. */
export function getPricingConfiguration(): PricingConfiguration {
  return activePricingConfiguration(loadData());
}

export function getPricingRules(): WindowCleaningPricingRules {
  return getPricingConfiguration().rules;
}

/**
 * Saves an edited rate card as a new pricing configuration version rather
 * than mutating the current one in place — see
 * docs/decisions/0009-pricing-configuration-versioning.md. Quotes already
 * priced under an earlier version keep their `pricingConfigId`, so this
 * never retroactively changes a quote that already exists.
 */
export function savePricingRules(rules: WindowCleaningPricingRules): void {
  const data = loadData();
  const current = activePricingConfiguration(data);
  data.pricingConfigurations.push({
    ...current,
    id: makeId("pricing-config"),
    version: current.version + 1,
    effectiveAt: nowIso(),
    rules,
  });
  saveData(data);
}

// ----------------------------------------------------------------- quotes --

export function listQuotes(): Quote[] {
  return [...loadData().quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getQuote(id: string): Quote | undefined {
  return loadData().quotes.find((q) => q.id === id);
}

export interface CreateQuoteInput {
  customer: Customer;
  property: Property;
  servicePreferences: ServicePreferences;
  notes: string;
  photos: { id: string; url: string }[];
  analysis: PropertyAnalysisResult;
}

function repriceQuote(quote: Quote, configuration: PricingConfiguration): void {
  const pricingInput = reconcilePricingInput(quote.servicePreferences, quote.analysis.characteristics);
  quote.estimate = calculateEstimate(pricingInput, configuration, quote.analysis.metadata.confidence);
}

/** Creates a quote and prices it through the real pricing engine using the business's current pricing configuration, pinning that version onto the quote. */
export function createQuote(input: CreateQuoteInput): Quote {
  const data = loadData();
  const configuration = activePricingConfiguration(data);
  const pricingInput = reconcilePricingInput(
    input.servicePreferences,
    input.analysis.characteristics,
  );
  const estimate = calculateEstimate(
    pricingInput,
    configuration,
    input.analysis.metadata.confidence,
  );
  const timestamp = nowIso();

  const quote: Quote = {
    id: makeId("quote"),
    businessId: demoBusiness.id,
    customer: input.customer,
    property: input.property,
    servicePreferences: input.servicePreferences,
    notes: input.notes,
    photos: input.photos,
    analysis: input.analysis,
    estimate,
    pricingConfigId: configuration.id,
    status: "new",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  data.quotes.push(quote);
  saveData(data);
  return quote;
}

/**
 * Overwrites the quote's structured characteristics and re-prices it against
 * the SAME pricing configuration it was originally created under (looked up
 * by its pinned `pricingConfigId`) — correcting what a job involves must not
 * silently pull in whatever prices are active today. Use
 * `recalculateQuoteEstimate` to explicitly opt a quote into current pricing.
 */
export function updateQuoteAnalysis(
  id: string,
  characteristics: WindowCleaningCharacteristics,
): Quote {
  const data = loadData();
  const quote = data.quotes.find((q) => q.id === id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);

  quote.analysis = { ...quote.analysis, characteristics };
  repriceQuote(quote, findPricingConfiguration(data, quote.pricingConfigId));
  quote.updatedAt = nowIso();

  saveData(data);
  return quote;
}

/**
 * Re-prices the quote's existing characteristics against the business's
 * CURRENT pricing configuration and re-pins `pricingConfigId` to it — an
 * explicit opt-in to today's rules, used when rules changed since the quote
 * was created.
 */
export function recalculateQuoteEstimate(id: string): Quote {
  const data = loadData();
  const quote = data.quotes.find((q) => q.id === id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);

  const configuration = activePricingConfiguration(data);
  repriceQuote(quote, configuration);
  quote.pricingConfigId = configuration.id;
  quote.updatedAt = nowIso();

  saveData(data);
  return quote;
}

export function updateQuoteStatus(id: string, status: QuoteStatus): Quote {
  const data = loadData();
  const quote = data.quotes.find((q) => q.id === id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);
  if (!canTransitionQuoteStatus(quote.status, status)) {
    throw new Error(`Cannot move a quote from "${quote.status}" to "${status}".`);
  }

  quote.status = status;
  quote.updatedAt = nowIso();
  saveData(data);
  return quote;
}

// --------------------------------------------------------------- settings --

export function getBusinessSettings(): BusinessSettings {
  return loadData().settings;
}

export function saveBusinessSettings(settings: BusinessSettings): void {
  const data = loadData();
  data.settings = settings;
  saveData(data);
}
