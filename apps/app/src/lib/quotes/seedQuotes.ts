import type { PropertyAnalysisResult, Quote, WindowCleaningCharacteristics } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "@tallyvis/pricing";
import { demoBusiness } from "@tallyvis/config";
import { reconcilePricingInput } from "../pricingReconciliation";

/**
 * ============================== DEMO DATA ==============================
 * Hand-authored fictional quotes so the dashboard has something to show on
 * first load. The single, clearly-identified location for this app's mock
 * quote data — nothing else in the dashboard hard-codes a fake quote.
 * Estimates are computed through the real pricing engine, not typed in by
 * hand, so the numbers are always internally consistent.
 * =========================================================================
 */

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function characteristics(
  overrides: Partial<WindowCleaningCharacteristics>,
): WindowCleaningCharacteristics {
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
    ...overrides,
  };
}

function analysis(
  chars: WindowCleaningCharacteristics,
  confidence: PropertyAnalysisResult["metadata"]["confidence"],
  notes?: string[],
): PropertyAnalysisResult {
  return { characteristics: chars, metadata: { confidence, notes } };
}

interface SeedInput {
  id: string;
  customerName: string;
  email: string;
  phone: string;
  propertyType: Quote["property"]["propertyType"];
  address: string;
  characteristics: WindowCleaningCharacteristics;
  confidence: PropertyAnalysisResult["metadata"]["confidence"];
  notes?: string[];
  wantsScreens: boolean;
  wantsTracks: boolean;
  customerNotes: string;
  status: Quote["status"];
  createdHoursAgo: number;
}

function buildSeedQuote(input: SeedInput): Quote {
  const servicePreferences = {
    interiorCleaning: false,
    screens: input.wantsScreens,
    tracks: input.wantsTracks,
    hardWaterTreatment: "unsure" as const,
  };
  const result = analysis(input.characteristics, input.confidence, input.notes);
  const pricingInput = reconcilePricingInput(servicePreferences, result.characteristics);
  const estimate = calculateWindowCleaningEstimate(
    pricingInput,
    demoBusiness.pricingRules,
    input.confidence,
  );
  const createdAt = hoursAgo(input.createdHoursAgo);

  return {
    id: input.id,
    businessId: demoBusiness.id,
    customer: { name: input.customerName, email: input.email, phone: input.phone },
    property: {
      propertyType: input.propertyType,
      stories: input.characteristics.stories,
      address: input.address,
    },
    servicePreferences,
    notes: input.customerNotes,
    photos: [],
    analysis: result,
    estimate,
    status: input.status,
    createdAt,
    updatedAt: createdAt,
  };
}

export function seedQuotes(): Quote[] {
  return [
    buildSeedQuote({
      id: "quote-jane-smith",
      customerName: "Jane Smith",
      email: "jane.smith@example.com",
      phone: "(555) 201-4477",
      propertyType: "single-family",
      address: "142 Maple St",
      characteristics: characteristics({
        windowCount: 24,
        stories: 2,
        screens: 10,
        tracks: 10,
        accessibility: "moderate",
        estimatedLaborHours: 2.6,
      }),
      confidence: "medium",
      notes: ["Some windows were partially obscured in the submitted photos."],
      wantsScreens: true,
      wantsTracks: true,
      customerNotes: "Some windows on the back of the house are hard to access.",
      status: "needs_review",
      createdHoursAgo: 3,
    }),
    buildSeedQuote({
      id: "quote-mike-johnson",
      customerName: "Mike Johnson",
      email: "mike.johnson@example.com",
      phone: "(555) 384-2201",
      propertyType: "single-family",
      address: "88 Birchwood Ave",
      characteristics: characteristics({
        windowCount: 16,
        stories: 1,
        screens: 8,
        tracks: 8,
        accessibility: "easy",
        estimatedLaborHours: 1.6,
      }),
      confidence: "high",
      wantsScreens: true,
      wantsTracks: false,
      customerNotes: "",
      status: "sent",
      createdHoursAgo: 5,
    }),
    buildSeedQuote({
      id: "quote-sarah-williams",
      customerName: "Sarah Williams",
      email: "sarah.williams@example.com",
      phone: "(555) 927-1183",
      propertyType: "single-family",
      address: "310 Oak Ridge Dr",
      characteristics: characteristics({
        windowCount: 32,
        stories: 3,
        screens: 14,
        tracks: 14,
        accessibility: "difficult",
        estimatedLaborHours: 4.1,
      }),
      confidence: "high",
      wantsScreens: true,
      wantsTracks: true,
      customerNotes: "Please call before arriving, gate code required.",
      status: "new",
      createdHoursAgo: 22,
    }),
    buildSeedQuote({
      id: "quote-carlos-ortiz",
      customerName: "Carlos Ortiz",
      email: "carlos.ortiz@example.com",
      phone: "(555) 662-9034",
      propertyType: "townhouse",
      address: "19 Cedar Ln, Unit B",
      characteristics: characteristics({
        windowCount: 12,
        stories: 2,
        screens: 6,
        tracks: 0,
        accessibility: "moderate",
        hardWaterStaining: true,
        estimatedLaborHours: 1.9,
      }),
      confidence: "medium",
      wantsScreens: true,
      wantsTracks: false,
      customerNotes: "There's some mineral staining on the ground-floor windows.",
      status: "approved",
      createdHoursAgo: 30,
    }),
    buildSeedQuote({
      id: "quote-emily-chen",
      customerName: "Emily Chen",
      email: "emily.chen@example.com",
      phone: "(555) 445-6690",
      propertyType: "single-family",
      address: "77 Pine Ct",
      characteristics: characteristics({
        windowCount: 14,
        stories: 1,
        screens: 6,
        tracks: 6,
        accessibility: "easy",
        estimatedLaborHours: 1.4,
      }),
      confidence: "high",
      wantsScreens: true,
      wantsTracks: true,
      customerNotes: "",
      status: "accepted",
      createdHoursAgo: 48,
    }),
    buildSeedQuote({
      id: "quote-tom-baker",
      customerName: "Tom Baker",
      email: "tom.baker@example.com",
      phone: "(555) 118-7742",
      propertyType: "other",
      address: "",
      characteristics: characteristics({
        windowCount: 10,
        stories: 1,
        screens: 0,
        tracks: 0,
        accessibility: "easy",
        estimatedLaborHours: 1.1,
      }),
      confidence: "low",
      notes: ["Only a few photos were provided — add more angles of the property."],
      wantsScreens: false,
      wantsTracks: false,
      customerNotes: "",
      status: "more_information",
      createdHoursAgo: 6,
    }),
  ];
}
