import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import {
  getCurrentBusiness,
  updateCurrentBusiness,
  updateSmsNotificationSettings,
  normalizePhoneNumber,
} from "../services/business";

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

  it("normalizes a valid brand color to uppercase", async () => {
    const { db, session } = await setUp();
    const updated = await updateCurrentBusiness(db, session, {
      name: "Sparkle Windows",
      email: "hello@sparkle.example",
      phone: "",
      serviceArea: "",
      brandColor: "#0057b8",
    });
    expect(updated.brandColor).toBe("#0057B8");
  });

  it("rejects a malformed brand color", async () => {
    const { db, session } = await setUp();
    await expect(
      updateCurrentBusiness(db, session, {
        name: "Sparkle Windows",
        email: "hello@sparkle.example",
        phone: "",
        serviceArea: "",
        brandColor: "blue",
      }),
    ).rejects.toThrow(/six-digit hex/);
  });

  it("rejects a brand color carrying more than a color, e.g. an attempted CSS/script injection", async () => {
    const { db, session } = await setUp();
    await expect(
      updateCurrentBusiness(db, session, {
        name: "Sparkle Windows",
        email: "hello@sparkle.example",
        phone: "",
        serviceArea: "",
        brandColor: "#000000; } body { background: url(javascript:alert(1))",
      }),
    ).rejects.toThrow(/six-digit hex/);
  });

  it("rejects a non-http(s) logo URL", async () => {
    const { db, session } = await setUp();
    await expect(
      updateCurrentBusiness(db, session, {
        name: "Sparkle Windows",
        email: "hello@sparkle.example",
        phone: "",
        serviceArea: "",
        logoUrl: "javascript:alert(1)",
      }),
    ).rejects.toThrow(/http/);
  });
});

describe("normalizePhoneNumber", () => {
  it("assumes US/+1 for a bare 10-digit number, in whatever formatting", () => {
    expect(normalizePhoneNumber("5551234567")).toBe("+15551234567");
    expect(normalizePhoneNumber("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhoneNumber("555.123.4567")).toBe("+15551234567");
  });

  it("accepts an 11-digit number already carrying a US country code", () => {
    expect(normalizePhoneNumber("15551234567")).toBe("+15551234567");
    expect(normalizePhoneNumber("1 (555) 123-4567")).toBe("+15551234567");
  });

  it("accepts an already-E.164 number as-is", () => {
    expect(normalizePhoneNumber("+15551234567")).toBe("+15551234567");
    expect(normalizePhoneNumber("+442071838750")).toBe("+442071838750");
  });

  it("rejects anything that isn't a plausible phone number", () => {
    expect(normalizePhoneNumber("not a phone number")).toBeNull();
    expect(normalizePhoneNumber("123")).toBeNull();
    expect(normalizePhoneNumber("")).toBeNull();
    expect(normalizePhoneNumber("+0123456789")).toBeNull();
  });
});

describe("updateSmsNotificationSettings", () => {
  it("saves a normalized notification phone number with SMS enabled", async () => {
    const { db, session } = await setUp();
    const updated = await updateSmsNotificationSettings(db, session, {
      enabled: true,
      notificationPhone: "(555) 987-6543",
    });
    expect(updated.smsNotificationsEnabled).toBe(true);
    expect(updated.notificationPhone).toBe("+15559876543");
  });

  it("defaults to disabled with no notification phone for a newly-created business", async () => {
    const { db, session } = await setUp();
    const business = await getCurrentBusiness(db, session);
    expect(business.smsNotificationsEnabled).toBe(false);
    expect(business.notificationPhone).toBeUndefined();
  });

  it("rejects turning notifications on with no valid phone number on file", async () => {
    const { db, session } = await setUp();
    await expect(updateSmsNotificationSettings(db, session, { enabled: true })).rejects.toThrow(
      /notification phone number/,
    );
  });

  it("rejects an unparseable phone number rather than silently disabling", async () => {
    const { db, session } = await setUp();
    await expect(
      updateSmsNotificationSettings(db, session, { enabled: true, notificationPhone: "not a phone number" }),
    ).rejects.toThrow(/valid phone number/);
  });

  it("allows saving disabled with no phone number, and clearing a previously-saved one", async () => {
    const { db, session } = await setUp();
    await updateSmsNotificationSettings(db, session, { enabled: true, notificationPhone: "5551234567" });
    const cleared = await updateSmsNotificationSettings(db, session, { enabled: false, notificationPhone: "" });
    expect(cleared.smsNotificationsEnabled).toBe(false);
    expect(cleared.notificationPhone).toBeUndefined();
  });
});
