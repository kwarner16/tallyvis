import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { getCurrentBusiness, updateCurrentBusiness } from "../services/business";

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

describe("updateCurrentBusiness", () => {
  it("updates the business's own settings", async () => {
    const { db, session } = await setUp();

    const updated = await updateCurrentBusiness(db, session, {
      name: "Sparkle Windows LLC",
      email: "hello@sparkle.example",
      phone: "(555) 010-0110",
      serviceArea: "Greater Springfield area",
    });

    expect(updated.name).toBe("Sparkle Windows LLC");
    expect(await getCurrentBusiness(db, session)).toEqual(updated);
  });

  it("rejects an empty business name", async () => {
    const { db, session } = await setUp();
    await expect(
      updateCurrentBusiness(db, session, {
        name: "   ",
        email: "hello@sparkle.example",
        phone: "",
        serviceArea: "",
      }),
    ).rejects.toThrow(/name is required/);
  });

  it("rejects an invalid business email", async () => {
    const { db, session } = await setUp();
    await expect(
      updateCurrentBusiness(db, session, {
        name: "Sparkle Windows",
        email: "not-an-email",
        phone: "",
        serviceArea: "",
      }),
    ).rejects.toThrow(/valid business email/);
  });

  it("a rejected update does not change the persisted business", async () => {
    const { db, session } = await setUp();
    const before = await getCurrentBusiness(db, session);

    await expect(
      updateCurrentBusiness(db, session, { name: "", email: "x@example.com", phone: "", serviceArea: "" }),
    ).rejects.toThrow();

    expect(await getCurrentBusiness(db, session)).toEqual(before);
  });
});
