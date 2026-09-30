import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, TRIAL_POLICY, getTrialDaysForNewSubscription } from "../trial";

describe("getTrialDaysForNewSubscription", () => {
  it("returns the promotional length for any qualifying instant through the end of 2026", () => {
    expect(getTrialDaysForNewSubscription(new Date("2026-01-01T00:00:00.000Z"))).toBe(30);
    expect(getTrialDaysForNewSubscription(new Date("2026-06-15T12:00:00.000Z"))).toBe(30);
    expect(getTrialDaysForNewSubscription(new Date("2026-12-31T23:59:59.999Z"))).toBe(30);
  });

  it("returns the normal default length exactly at and after the promotion end boundary", () => {
    expect(getTrialDaysForNewSubscription(new Date("2027-01-01T00:00:00.000Z"))).toBe(7);
    expect(getTrialDaysForNewSubscription(new Date("2027-01-01T00:00:00.001Z"))).toBe(7);
    expect(getTrialDaysForNewSubscription(new Date("2027-06-01T00:00:00.000Z"))).toBe(7);
  });

  it("matches the policy's own configured values", () => {
    expect(getTrialDaysForNewSubscription(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      TRIAL_POLICY.promoTrialDays,
    );
    expect(getTrialDaysForNewSubscription(new Date("2027-01-01T00:00:00.000Z"))).toBe(
      TRIAL_POLICY.defaultTrialDays,
    );
  });

  it("defaults to the current time when no date is given", () => {
    // Sanity check only: whatever "now" resolves to must be one of the two valid lengths.
    const days = getTrialDaysForNewSubscription();
    expect([TRIAL_POLICY.promoTrialDays, TRIAL_POLICY.defaultTrialDays]).toContain(days);
  });
});

describe("TRIAL_DAYS", () => {
  it("still names the normal (non-promotional) trial length, for anything that only needs the fallback", () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(TRIAL_DAYS).toBe(TRIAL_POLICY.defaultTrialDays);
  });
});
