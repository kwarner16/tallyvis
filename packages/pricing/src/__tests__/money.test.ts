import { describe, expect, it } from "vitest";
import { roundMoney } from "../money";

describe("roundMoney", () => {
  it("rounds to the nearest cent", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it("fixes floating-point drift from repeated addition", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754 floating point.
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it("leaves already-exact cent values unchanged", () => {
    expect(roundMoney(125)).toBe(125);
    expect(roundMoney(19.99)).toBe(19.99);
  });

  it("rounds negative values to the nearest cent", () => {
    expect(roundMoney(-10.005)).toBe(-10.01);
    expect(roundMoney(-10.001)).toBe(-10);
  });

  it("rounds zero to zero", () => {
    expect(roundMoney(0)).toBe(0);
  });
});
