import { describe, expect, it } from "vitest";
import { isWordmarkNavigable } from "../wordmarkNavigation";

/**
 * Production hardening (2026-10): the embedded estimator's "Tallyvis"
 * wordmark used to be an internal `Link href="/estimate"` even while
 * embedded, which took a customer from a business's branded, in-progress
 * estimator to the bare `/estimate` welcome screen — generic, unbranded,
 * "prototype experience" copy with no sign a real business was ever
 * involved. See `StepShell.tsx`'s own comment on `TallyvisWordmark` for
 * the full incident writeup. This is the one invariant that fix rests on.
 */
describe("isWordmarkNavigable — embedded estimator cannot navigate into the demo", () => {
  it("is not navigable while embedded — clicking it must never be able to leave the business's estimator", () => {
    expect(isWordmarkNavigable(true)).toBe(false);
  });

  it("stays navigable (to the marketing site) on the direct, un-embedded estimator", () => {
    expect(isWordmarkNavigable(false)).toBe(true);
  });
});
