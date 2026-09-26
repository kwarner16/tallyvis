import fs from "node:fs";
import path from "node:path";

/**
 * 2026-09 "obvious window" incident (docs/decisions/0025) — a real,
 * controlled verification of the SYSTEM_PROMPT in providers/anthropic.ts
 * against the REAL Anthropic API (never mocked), using the synthetic test
 * images `generate-window-test-images.mjs` produces. This is how the
 * incident's root cause (the prompt telling the model to withhold
 * "observed" windowCount unless it could vouch for the property's WHOLE
 * total, which a single close-up photo can never do) was proven, and how
 * the fix was verified empirically, not just by reasoning about the
 * prompt text.
 *
 * Requires a real `AI_PROVIDER_API_KEY` (Anthropic) in the environment —
 * never committed, never printed by this script. Costs real API tokens;
 * run manually, not in CI:
 *
 *   AI_PROVIDER_API_KEY=sk-ant-... npx tsx scripts/verify-window-count-against-real-api.mjs
 *
 * (needs `tsx`, not plain `node` — this imports the provider's real .ts
 * source directly, the same code path production uses, not a build output)
 *
 * Prints only safe, structured diagnostics (model, token usage,
 * validated observation fields) — never raw image bytes/base64.
 */

const apiKey = process.env.AI_PROVIDER_API_KEY;
if (!apiKey) {
  console.error("Set AI_PROVIDER_API_KEY (a real Anthropic key) in the environment before running this script.");
  process.exit(1);
}

const { outDir } = await import("./generate-window-test-images.mjs");
const { createAnthropicProvider } = await import("../src/providers/anthropic.ts");
const { validateRawPropertyObservation } = await import("../src/validateObservation.ts");

const provider = createAnthropicProvider({ apiKey, model: process.env.AI_PROVIDER_MODEL });

const cases = [
  { name: "CASE A - one obvious window", file: "case_a_one_obvious_window.png", expect: "observed, value 1" },
  { name: "CASE B - three windows", file: "case_b_three_windows.png", expect: "observed, value 3" },
  { name: "CASE C - partial coverage / cropped", file: "case_c_partial_coverage.png", expect: "observed, visible count; coverage flagged incomplete" },
  { name: "CASE D - obscured window", file: "case_d_obscured_window.png", expect: "observed or uncertain, never a confident wrong count" },
  { name: "CASE E - no windows", file: "case_e_no_windows.png", expect: "unknown, no invented count" },
];

for (const c of cases) {
  const buf = fs.readFileSync(path.join(outDir, c.file));
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  const metadata = { vertical: "window-cleaning" };

  console.log(`\n=== ${c.name} (expect: ${c.expect}) ===`);
  try {
    const result = await provider.analyzeProperty([{ url: dataUrl }], metadata);
    const validation = validateRawPropertyObservation(result.raw);
    const obs = validation.ok ? validation.value : null;
    console.log(JSON.stringify({
      model: result.meta.model,
      requestId: result.meta.requestId,
      stopReason: result.meta.stopReason,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
      validationOk: validation.ok,
      windowCount: obs?.windowCount,
      evidence: obs?.evidence,
    }, null, 2));
  } catch (err) {
    console.log("PROVIDER ERROR:", err instanceof Error ? err.message : err, err?.category, err?.detail);
  }
}
