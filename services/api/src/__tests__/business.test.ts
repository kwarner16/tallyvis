import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { getCurrentBusiness, updateCurrentBusiness } from "../services/business";

async function setUp() {
  const db = createTestDb();
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

    const updated = updateCurrentBusiness(db, session, {
      name: "Sparkle Windows LLC",
      email: "hello@sparkle.example",
      phone: "(555) 010-0110",
      serviceArea: "Greater Springfield area",
    });

    expect(updated.name).toBe("Sparkle Windows LLC");
    expect(getCurrentBusiness(db, session)).toEqual(updated);
  });

  it("rejects an empty business name", async () => {
    const { db, session } = await setUp();
    expect(() =>
      updateCurrentBusiness(db, session, {
        name: "   ",
        email: "hello@sparkle.example",
        phone: "",
        serviceArea: "",
      }),
    ).toThrow(/name is required/);
  });

  it("rejects an invalid business email", async () => {
    const { db, session } = await setUp();
    expect(() =>
      updateCurrentBusiness(db, session, {
        name: "Sparkle Windows",
        email: "not-an-email",
        phone: "",
        serviceArea: "",
      }),
    ).toThrow(/valid business email/);
  });

  it("a rejected update does not change the persisted business", async () => {
    const { db, session } = await setUp();
    const before = getCurrentBusiness(db, session);

    expect(() =>
      updateCurrentBusiness(db, session, { name: "", email: "x@example.com", phone: "", serviceArea: "" }),
    ).toThrow();

    expect(getCurrentBusiness(db, session)).toEqual(before);
  });
});
