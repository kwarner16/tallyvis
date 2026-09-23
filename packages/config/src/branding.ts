/**
 * Estimator brand-color derivation (business-controlled estimator branding —
 * see docs/decisions/0016-onboarding-billing-embed.md for the `brand_color`
 * field this builds on top of). Pure, dependency-free color math so both
 * `services/api` (server-side validation on save) and `apps/app` (deriving
 * the estimator's live theme) share one implementation rather than two
 * copies that could drift — the exact class of duplication CLAUDE.md's
 * module boundaries elsewhere in this repo exist to prevent.
 */

const SIX_DIGIT_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Validates and normalizes a six-digit hex color to uppercase
 * (`"#0057b8"` -> `"#0057B8"`). Returns `null` for anything else —
 * shorthand 3-digit hex, named colors, `rgb(...)`, empty/whitespace, or any
 * other value that isn't exactly what CLAUDE.md's brand-color contract
 * accepts. Never throws; callers decide how to react to `null`.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!SIX_DIGIT_HEX.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two relative luminances — always >= 1. */
function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE: [number, number, number] = [255, 255, 255];
const NEAR_BLACK: [number, number, number] = [17, 17, 17];

/**
 * Whichever of white or near-black gives better contrast against `hex`,
 * as a hex color itself — the answer to "what text color goes on top of
 * this brand color" (Part 15's WCAG AA requirement). `hex` must already be
 * a normalized six-digit hex (validate with `normalizeHexColor` first);
 * malformed input falls back to near-black text, the safer default against
 * an unknown/light background.
 */
export function getContrastForeground(hex: string): string {
  if (!SIX_DIGIT_HEX.test(hex)) return rgbToHex(NEAR_BLACK);
  const bg = hexToRgb(hex);
  const bgLuminance = relativeLuminance(bg);
  const whiteContrast = contrastRatio(bgLuminance, relativeLuminance(WHITE));
  const blackContrast = contrastRatio(bgLuminance, relativeLuminance(NEAR_BLACK));
  return whiteContrast >= blackContrast ? rgbToHex(WHITE) : rgbToHex(NEAR_BLACK);
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = target;
  return rgbToHex([r + (tr - r) * amount, g + (tg - g) * amount, b + (tb - b) * amount]);
}

/** The estimator's brand-derived CSS custom properties, matching @tallyvis/ui's theme.css token names exactly so they cascade over the defaults via inline style. */
export interface EstimatorThemeVars {
  "--color-accent": string;
  "--color-accent-strong": string;
  "--color-accent-strong-hover": string;
  "--color-accent-soft": string;
  "--color-accent-foreground": string;
}

/**
 * Derives a small, consistent estimator theme from one business-chosen
 * brand color — not twenty individually-configured colors (Part 15).
 * `primaryHex` should already be normalized; returns `null` for anything
 * that isn't a valid six-digit hex so callers can fall back to the default
 * Tallyvis theme (Part 18) rather than applying a broken override.
 */
export function deriveEstimatorTheme(primaryHex: string | null | undefined): EstimatorThemeVars | null {
  const hex = normalizeHexColor(primaryHex);
  if (!hex) return null;
  return {
    "--color-accent": hex,
    "--color-accent-strong": hex,
    "--color-accent-strong-hover": mix(hex, NEAR_BLACK, 0.18),
    "--color-accent-soft": mix(hex, WHITE, 0.88),
    "--color-accent-foreground": getContrastForeground(hex),
  };
}
