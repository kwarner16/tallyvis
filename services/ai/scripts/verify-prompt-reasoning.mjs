import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

/**
 * 2026-09 "obvious window" incident (docs/decisions/0025) — a cheap,
 * vision-free sanity check of the SYSTEM_PROMPT's own reasoning, isolated
 * from any question of whether a given image is realistic/well-composed
 * enough for the vision model to parse. Asks the model, in plain text
 * (no photos, no tool call), to explain what it WOULD report for a
 * described single-obvious-window scenario, quoting its own stated
 * reasoning back — this is what first proved the root cause: the model
 * explicitly cited "only use observed when confident the visible windows
 * ARE the property's total" (the old wording) as its reason for
 * withholding "observed" even though it saw the window "with total
 * clarity."
 *
 * Requires a real `AI_PROVIDER_API_KEY` (Anthropic) in the environment.
 * Run manually, not in CI: `AI_PROVIDER_API_KEY=sk-ant-... node scripts/verify-prompt-reasoning.mjs`
 */

const apiKey = process.env.AI_PROVIDER_API_KEY;
if (!apiKey) {
  console.error("Set AI_PROVIDER_API_KEY (a real Anthropic key) in the environment before running this script.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const anthropicSrc = fs.readFileSync(path.join(__dirname, "../src/providers/anthropic.ts"), "utf8");
const match = anthropicSrc.match(/const SYSTEM_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/);
const SYSTEM_PROMPT = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
  .map((m) => m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"))
  .join("\n");

const client = new Anthropic({ apiKey });

const question = `You are given this exact scenario (no photos attached — reason about the described scenario in words):

A customer submits exactly ONE photo. The photo was taken indoors, in good lighting, with the camera positioned about five feet from a window, pointed directly at it. The window fills a large portion of the frame. It is unobstructed, clearly in focus, and unambiguously a single distinct window opening. No other part of the building's exterior or interior is visible in this photo — just this one window, clearly.

Given your system instructions above, what status would you report for the "windowCount" field: "observed", "uncertain", or "unknown"? What value (if any) would you attach? What would "evidence.coverage" and "evidence.overallEvidence" be?

Answer plainly in a few sentences, explaining your reasoning by reference to your own instructions above. Do not call any tool — just answer in plain text.`;

const response = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: question }],
});

console.log("=== Model's own explanation of what the CURRENT prompt tells it to do for a single obvious window photo ===\n");
for (const block of response.content) {
  if (block.type === "text") console.log(block.text);
}
