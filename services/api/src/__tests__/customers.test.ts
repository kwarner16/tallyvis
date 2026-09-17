import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { findOrCreateCustomer, getCustomer, listCustomers, updateCustomer } from "../services/customers";

async function setUp() {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("findOrCreateCustomer", () => {
  it("creates a new customer scoped to the business", async () => {
    const { db, session } = await setUp();
    const customer = findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });

    expect(customer.businessId).toBe(session.businessId);
    expect(getCustomer(db, session, customer.id)).toEqual(customer);
  });

  it("reuses an existing customer matched by email, case-insensitively", async () => {
    const { db, session } = await setUp();
    const first = findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });
    const second = findOrCreateCustomer(db, session, { name: "Alice A.", email: "ALICE@example.com" });

    expect(second.id).toBe(first.id);
    expect(listCustomers(db, session)).toHaveLength(1);
  });

  it("rejects an empty name even though the UI is expected to prevent it — this is the authoritative check", async () => {
    const { db, session } = await setUp();
    expect(() => findOrCreateCustomer(db, session, { name: "  ", email: "alice@example.com" })).toThrow(
      /name is required/,
    );
  });

  it("rejects an invalid email", async () => {
    const { db, session } = await setUp();
    expect(() => findOrCreateCustomer(db, session, { name: "Alice", email: "not-an-email" })).toThrow(
      /valid customer email/,
    );
  });
});

describe("updateCustomer", () => {
  it("updates the customer's details", async () => {
    const { db, session } = await setUp();
    const customer = findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });

    const updated = updateCustomer(db, session, customer.id, {
      name: "Alice Anderson",
      email: "alice.anderson@example.com",
      phone: "(555) 222-3333",
    });

    expect(updated.name).toBe("Alice Anderson");
    expect(updated.email).toBe("alice.anderson@example.com");
    expect(updated.phone).toBe("(555) 222-3333");
  });

  it("throws for a customer that doesn't exist", async () => {
    const { db, session } = await setUp();
    expect(() =>
      updateCustomer(db, session, "not-a-real-customer", { name: "X", email: "x@example.com" }),
    ).toThrow(/not found/);
  });
});
