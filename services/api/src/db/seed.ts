/**
 * Development-only seed script. Creates one demo business, one owner
 * account, a starter pricing configuration, and a handful of realistic
 * quotes — explicitly labeled dev data, never something a running
 * production app generates itself. Run with `pnpm --filter @tallyvis/api
 * seed` (see docs/decisions/0011-persistence-auth-and-multi-tenancy.md for
 * how this replaces the old localStorage `seedQuotes()`).
 *
 * Safe to re-run: exits without doing anything if the dev account already
 * exists.
 */
import type { PropertyAnalysisResult, WindowCleaningCharacteristics } from "@tallyvis/types";
import { calculateEstimate, reconcilePricingInput } from "@tallyvis/pricing";
import { demoBusiness, windowCleaningDefaultPricingRules } from "@tallyvis/config";
import { getDb } from "./pg/client";
import { hashPassword } from "../auth/password";
import { createBusiness } from "../repositories/businesses";
import { createUser, getUserWithPasswordHashByEmail } from "../repositories/users";
import { createInitialPricingConfiguration } from "../repositories/pricingConfigurations";
import { createCustomer } from "../repositories/customers";
import { createQuoteRecord } from "../repositories/quotes";

export const DEV_OWNER_EMAIL = "owner@demowindowcleaning.example";
export const DEV_OWNER_PASSWORD = "tallyvis-dev-password";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function characteristics(overrides: Partial<WindowCleaningCharacteristics>): WindowCleaningCharacteristics {
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

interface SeedQuoteInput {
  customerName: string;
  email: string;
  phone: string;
  propertyType: "single-family" | "townhouse" | "other";
  address: string;
  characteristics: WindowCleaningCharacteristics;
  confidence: PropertyAnalysisResult["metadata"]["confidence"];
  notes?: string[];
  wantsScreens: boolean;
  wantsTracks: boolean;
  customerNotes: string;
  status: "new" | "needs_review" | "more_information" | "approved" | "sent" | "accepted";
  createdHoursAgo: number;
}

const SEED_QUOTES: SeedQuoteInput[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

async function main() {
  const db = getDb();

  if (await getUserWithPasswordHashByEmail(db, DEV_OWNER_EMAIL)) {
    console.log(`Seed data already present (${DEV_OWNER_EMAIL}) — skipping.`);
    return;
  }

  const business = await createBusiness(db, {
    name: demoBusiness.name,
    email: DEV_OWNER_EMAIL,
    phone: "(555) 010-0110",
    serviceArea: "Greater Springfield area",
  });
  const configuration = await createInitialPricingConfiguration(db, business.id, windowCleaningDefaultPricingRules);
  const passwordHash = await hashPassword(DEV_OWNER_PASSWORD);
  await createUser(db, business.id, DEV_OWNER_EMAIL, passwordHash);

  for (const input of SEED_QUOTES) {
    const customer = await createCustomer(db, business.id, {
      name: input.customerName,
      email: input.email,
      phone: input.phone,
    });
    const servicePreferences = {
      interiorCleaning: false,
      screens: input.wantsScreens,
      tracks: input.wantsTracks,
      hardWaterTreatment: "unsure" as const,
    };
    const analysis: PropertyAnalysisResult = {
      characteristics: input.characteristics,
      metadata: { confidence: input.confidence, notes: input.notes },
    };
    const pricingInput = reconcilePricingInput(servicePreferences, input.characteristics);
    const estimate = calculateEstimate(pricingInput, configuration, input.confidence);
    const createdAt = hoursAgo(input.createdHoursAgo);

    await createQuoteRecord(db, business.id, {
      customerId: customer.id,
      pricingConfigId: configuration.id,
      property: {
        propertyType: input.propertyType,
        stories: input.characteristics.stories,
        address: input.address,
      },
      servicePreferences,
      notes: input.customerNotes,
      photos: [],
      analysis,
      estimate,
      status: input.status,
      createdAt,
    });
  }

  console.log(`Seeded business "${business.name}" (${business.id}).`);
  console.log(`Log in with: ${DEV_OWNER_EMAIL} / ${DEV_OWNER_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
