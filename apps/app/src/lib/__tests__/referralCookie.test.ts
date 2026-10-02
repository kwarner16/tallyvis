import { describe, expect, it } from "vitest";
import { encodeReferralCookieValue, decodeReferralCookieValue } from "../referralCookie";

describe("encodeReferralCookieValue / decodeReferralCookieValue", () => {
  it("round-trips a slug and timestamp", () => {
    const value = { slug: "ben", firstObservedAt: "2026-10-01T00:00:00.000Z" };
    expect(decodeReferralCookieValue(encodeReferralCookieValue(value))).toEqual(value);
  });

  it("returns undefined for an absent cookie", () => {
    expect(decodeReferralCookieValue(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(decodeReferralCookieValue("")).toBeUndefined();
  });

  it("returns undefined for a value with no separator", () => {
    expect(decodeReferralCookieValue("justaslugwithnocolon")).toBeUndefined();
  });

  it("returns undefined when the slug half is empty", () => {
    expect(decodeReferralCookieValue(":2026-10-01T00:00:00.000Z")).toBeUndefined();
  });

  it("returns undefined for a non-date timestamp half (tampered/corrupted cookie)", () => {
    expect(decodeReferralCookieValue("ben:not-a-date")).toBeUndefined();
  });

  it("never throws on garbage input", () => {
    expect(() => decodeReferralCookieValue("::::")).not.toThrow();
    expect(() => decodeReferralCookieValue("a:b:c:d")).not.toThrow();
  });
});
