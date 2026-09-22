import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { getActiveConfiguration, saveNewPricingConfigurationVersion } from "../services/pricing";

const getDb = useTestDb();

async function setUp() {
  const db = getDb();
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
    const before = await getActiveConfiguration(db, session);

    await expect(
      saveNewPricingConfigurationVersion(db, session, { ...before.rules, basePrice: -1 }),
    ).rejects.toThrow(/negative/);

    expect(await getActiveConfiguration(db, session)).toEqual(before);
  });

  it("accepts a valid rate card and it becomes the new active configuration", async () => {
    const { db, session } = await setUp();
    const before = await getActiveConfiguration(db, session);

    const saved = await saveNewPricingConfigurationVersion(db, session, {
      ...before.rules,
      basePrice: before.rules.basePrice + 10,
    });

    expect(saved.version).toBe(before.version + 1);
    expect(await getActiveConfiguration(db, session)).toEqual(saved);
  });
});
