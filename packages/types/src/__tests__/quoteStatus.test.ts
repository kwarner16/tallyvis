import { describe, expect, it } from "vitest";
import { canTransitionQuoteStatus, QUOTE_STATUS_TRANSITIONS, type QuoteStatus } from "../index";

const ALL_STATUSES: QuoteStatus[] = [
  "new",
  "needs_review",
  "more_information",
  "approved",
  "sent",
  "accepted",
  "declined",
];

describe("canTransitionQuoteStatus", () => {
  it("allows the documented forward path: new -> needs_review -> approved -> sent -> accepted", () => {
    expect(canTransitionQuoteStatus("new", "needs_review")).toBe(true);
    expect(canTransitionQuoteStatus("needs_review", "approved")).toBe(true);
    expect(canTransitionQuoteStatus("approved", "sent")).toBe(true);
    expect(canTransitionQuoteStatus("sent", "accepted")).toBe(true);
  });

  it("allows the alternative paths called out in the product spec", () => {
    expect(canTransitionQuoteStatus("needs_review", "more_information")).toBe(true);
    expect(canTransitionQuoteStatus("sent", "declined")).toBe(true);
  });

  it("allows declining from every non-terminal status", () => {
    for (const status of ALL_STATUSES) {
      if (status === "accepted" || status === "declined") continue;
      expect(canTransitionQuoteStatus(status, "declined")).toBe(true);
    }
  });

  it("treats accepted and declined as terminal — no forward transitions", () => {
    expect(QUOTE_STATUS_TRANSITIONS.accepted).toHaveLength(0);
    expect(QUOTE_STATUS_TRANSITIONS.declined).toHaveLength(0);
  });

  it("rejects nonsensical jumps", () => {
    expect(canTransitionQuoteStatus("new", "sent")).toBe(false);
    expect(canTransitionQuoteStatus("new", "accepted")).toBe(false);
    expect(canTransitionQuoteStatus("sent", "new")).toBe(false);
    expect(canTransitionQuoteStatus("accepted", "new")).toBe(false);
    expect(canTransitionQuoteStatus("declined", "approved")).toBe(false);
  });

  it("rejects transitioning a status to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionQuoteStatus(status, status)).toBe(false);
    }
  });
});
