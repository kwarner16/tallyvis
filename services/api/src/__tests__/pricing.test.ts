import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { getActiveConfiguration, saveNewPricingConfigurationVersion } from "../services/pricing";

async function setUp() {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("saveNewPricingConfigurationVersion", () => {
  it("rejects an invalid rate card and does not create a new version", async () => {
    const { db, session } = await setUp();
    const before = getActiveConfiguration(db, session);

    expect(() =>
      saveNewPricingConfigurationVersion(db, session, { ...before.rules, basePrice: -1 }),
    ).toThrow(/negative/);

    expect(getActiveConfiguration(db, session)).toEqual(before);
  });

  it("accepts a valid rate card and it becomes the new active configuration", async () => {
    const { db, session } = await setUp();
    const before = getActiveConfiguration(db, session);

    const saved = saveNewPricingConfigurationVersion(db, session, {
      ...before.rules,
      basePrice: before.rules.basePrice + 10,
    });

    expect(saved.version).toBe(before.version + 1);
    expect(getActiveConfiguration(db, session)).toEqual(saved);
  });
});
