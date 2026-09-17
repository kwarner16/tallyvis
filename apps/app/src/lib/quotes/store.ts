import type {
  Customer,
  Property,
  PropertyAnalysisResult,
  Quote,
  QuoteStatus,
  ServicePreferences,
  WindowCleaningCharacteristics,
  WindowCleaningPricingRules,
} from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "@tallyvis/pricing";
import { demoBusiness } from "@tallyvis/config";
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
  pricingRules: WindowCleaningPricingRules;
  quotes: Quote[];
  settings: BusinessSettings;
}

function defaultData(): DashboardData {
  return {
    pricingRules: demoBusiness.pricingRules,
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
    if (!parsed.pricingRules || !Array.isArray(parsed.quotes) || !parsed.settings) {
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

export function getPricingRules(): WindowCleaningPricingRules {
  return loadData().pricingRules;
}

export function savePricingRules(rules: WindowCleaningPricingRules): void {
  const data = loadData();
  data.pricingRules = rules;
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

/** Creates a quote and prices it through the real pricing engine using the business's current rules. */
export function createQuote(input: CreateQuoteInput): Quote {
  const data = loadData();
  const pricingInput = reconcilePricingInput(
    input.servicePreferences,
    input.analysis.characteristics,
  );
  const estimate = calculateWindowCleaningEstimate(
    pricingInput,
    data.pricingRules,
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
    status: "new",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  data.quotes.push(quote);
  saveData(data);
  return quote;
}

/** Overwrites the quote's structured characteristics and recalculates its estimate through the real pricing engine. */
export function updateQuoteAnalysis(
  id: string,
  characteristics: WindowCleaningCharacteristics,
): Quote {
  const data = loadData();
  const quote = data.quotes.find((q) => q.id === id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);

  quote.analysis = { ...quote.analysis, characteristics };
  const pricingInput = reconcilePricingInput(quote.servicePreferences, characteristics);
  quote.estimate = calculateWindowCleaningEstimate(
    pricingInput,
    data.pricingRules,
    quote.analysis.metadata.confidence,
  );
  quote.updatedAt = nowIso();

  saveData(data);
  return quote;
}

/** Re-runs pricing with the quote's current characteristics against the business's current rules — used when rules changed since the quote was created. */
export function recalculateQuoteEstimate(id: string): Quote {
  const quote = getQuote(id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);
  return updateQuoteAnalysis(id, quote.analysis.characteristics);
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
