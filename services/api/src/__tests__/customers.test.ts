import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { findOrCreateCustomer, getCustomer, listCustomers, updateCustomer } from "../services/customers";

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

describe("findOrCreateCustomer", () => {
  it("creates a new customer scoped to the business", async () => {
    const { db, session } = await setUp();
    const customer = await findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });

    expect(customer.businessId).toBe(session.businessId);
    expect(await getCustomer(db, session, customer.id)).toEqual(customer);
  });

  it("reuses an existing customer matched by email, case-insensitively", async () => {
    const { db, session } = await setUp();
    const first = await findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });
    const second = await findOrCreateCustomer(db, session, { name: "Alice A.", email: "ALICE@example.com" });

    expect(second.id).toBe(first.id);
    expect(await listCustomers(db, session)).toHaveLength(1);
  });

  it("rejects an empty name even though the UI is expected to prevent it — this is the authoritative check", async () => {
    const { db, session } = await setUp();
    await expect(findOrCreateCustomer(db, session, { name: "  ", email: "alice@example.com" })).rejects.toThrow(
      /name is required/,
    );
  });

  it("rejects an invalid email", async () => {
    const { db, session } = await setUp();
    await expect(findOrCreateCustomer(db, session, { name: "Alice", email: "not-an-email" })).rejects.toThrow(
      /valid customer email/,
    );
  });
});

describe("updateCustomer", () => {
  it("updates the customer's details", async () => {
    const { db, session } = await setUp();
    const customer = await findOrCreateCustomer(db, session, { name: "Alice", email: "alice@example.com" });

    const updated = await updateCustomer(db, session, customer.id, {
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
    await expect(
      updateCustomer(db, session, "not-a-real-customer", { name: "X", email: "x@example.com" }),
    ).rejects.toThrow(/not found/);
  });
});
