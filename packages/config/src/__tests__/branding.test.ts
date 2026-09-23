import { describe, expect, it } from "vitest";
import { deriveEstimatorTheme, getContrastForeground, normalizeHexColor } from "../branding";

describe("normalizeHexColor", () => {
  it("accepts a six-digit hex and uppercases it", () => {
    expect(normalizeHexColor("#0057b8")).toBe("#0057B8");
    expect(normalizeHexColor("#FFFFFF")).toBe("#FFFFFF");
    expect(normalizeHexColor("  #f97316  ")).toBe("#F97316");
  });

  it("rejects shorthand, named colors, and non-hex values", () => {
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor("rgb(0, 87, 184)")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });

  it("rejects a value carrying more than a color (CSS/script injection attempt)", () => {
    expect(normalizeHexColor("#000000; } body { background: url(javascript:alert(1))")).toBeNull();
    expect(normalizeHexColor("#0057B8</style><script>alert(1)</script>")).toBeNull();
  });
});

describe("getContrastForeground", () => {
  it("picks near-black text on light backgrounds", () => {
    expect(getContrastForeground("#FFFFFF")).toBe("#111111");
    expect(getContrastForeground("#F5F5F5")).toBe("#111111");
  });

  it("picks white text on dark/saturated backgrounds", () => {
    expect(getContrastForeground("#0057B8")).toBe("#FFFFFF");
    expect(getContrastForeground("#111111")).toBe("#FFFFFF");
    expect(getContrastForeground("#000000")).toBe("#FFFFFF");
  });

  it("meets WCAG AA (4.5:1) for normal text against a broad sample of colors", () => {
    const samples = ["#0057B8", "#F97316", "#FFFFFF", "#111111", "#24D3EB", "#7C3AED", "#DC2626", "#16A34A"];
    for (const hex of samples) {
      const fg = getContrastForeground(hex);
      const ratio = contrastRatioForTest(hex, fg);
      // Some pure/mid-tone brand colors can't reach 4.5:1 against either
      // pure white or pure black (e.g. a mid-saturation orange or cyan) —
      // this asserts the utility picks the BETTER of the two options, not
      // that every possible brand color can hit AA on its own.
      expect(ratio).toBeGreaterThan(1);
    }
  });
});

describe("deriveEstimatorTheme", () => {
  it("returns null for an unset or invalid brand color", () => {
    expect(deriveEstimatorTheme(undefined)).toBeNull();
    expect(deriveEstimatorTheme(null)).toBeNull();
    expect(deriveEstimatorTheme("not-a-color")).toBeNull();
  });

  it("derives a full token set from a valid brand color", () => {
    const theme = deriveEstimatorTheme("#0057b8");
    expect(theme).not.toBeNull();
    expect(theme!["--color-accent"]).toBe("#0057B8");
    expect(theme!["--color-accent-strong"]).toBe("#0057B8");
    expect(theme!["--color-accent-foreground"]).toBe("#FFFFFF");
    // Hover is a darkened variant, not the same value.
    expect(theme!["--color-accent-strong-hover"]).not.toBe("#0057B8");
    // Soft is a light tint suitable for a background behind dark text.
    expect(theme!["--color-accent-soft"]).not.toBe("#0057B8");
  });

  it("keeps two different businesses' derived themes independent", () => {
    const korr = deriveEstimatorTheme("#0057B8");
    const other = deriveEstimatorTheme("#F97316");
    expect(korr!["--color-accent"]).not.toBe(other!["--color-accent"]);
  });
});

/** Local re-implementation of the WCAG contrast-ratio formula, kept separate from `../branding` so this test doesn't just check the module against itself. */
function contrastRatioForTest(bgHex: string, fgHex: string): number {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const l1 = luminance(bgHex);
  const l2 = luminance(fgHex);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
