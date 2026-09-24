import type { EvidenceIssue, RawPropertyObservation } from "./types";

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — turns a validated `RawPropertyObservation`'s structured `evidence`
 * into the specific, actionable follow-up-photo request a customer
 * actually sees, e.g. "The shrubs may be blocking part of the lower
 * facade — a closer photo from that side would help" rather than a bare
 * "upload more photos."
 *
 * Deliberately NOT a second free-form LLM call: the brief that motivated
 * this file explicitly says "keep the output constrained/safe," and a
 * small, fully-tested mapping from a bounded set of structured issue tags
 * to fixed, reviewed copy is safer, cheaper, and faster than asking a
 * model to generate customer-facing prose on every analysis — there is no
 * way for this function to hallucinate, leak a prompt, or say something
 * the product team hasn't reviewed. If a future need for genuinely
 * open-ended guidance emerges, that's a deliberate, separate decision —
 * not a default this function should quietly grow into.
 */

const ISSUE_MESSAGES: Record<EvidenceIssue, string> = {
  distance: "The photos were taken from far away — a closer photo would help us see the windows clearly.",
  vegetation: "Trees or shrubs may be blocking part of the property — a photo from a different angle would help.",
  vehicles: "A vehicle is blocking part of the view — a photo without it in the way would help.",
  glare: "Glare is making some windows hard to see clearly — a photo from a different angle or time of day would help.",
  darkness: "The photos are too dark to make out window details — a photo in better light would help.",
  blur: "One or more photos are blurry — a steadier or closer photo would help.",
  cropped_facade: "The photos don't show the full height or width of that side of the property — a wider shot would help.",
  unrelated_images: "Some of these photos don't look like they show the same property — please double check and upload photos of just this property.",
};

/**
 * The specific gaps worth telling a customer about, most important first.
 * Empty when the evidence is already sufficient — callers should treat an
 * empty array as "nothing to ask for," not render a blank prompt.
 *
 * `unrelated_images` is surfaced on its own (it's a data-integrity problem,
 * not a "photograph better" problem) and takes priority over every other
 * issue, since asking for a closer photo of the wrong property helps no
 * one. Otherwise, at most one line per NAMED issue in `evidence.issues`,
 * plus one general line when `coverage` is worse than "complete" but no
 * specific issue explains why (e.g. the model just never saw the other
 * sides, nothing physically blocked them).
 */
export function describeEvidenceGaps(observation: RawPropertyObservation): string[] {
  const { evidence } = observation;
  if (evidence.overallEvidence === "sufficient") return [];

  if (evidence.issues.includes("unrelated_images")) {
    return [ISSUE_MESSAGES.unrelated_images];
  }

  const messages = evidence.issues.filter((issue) => issue !== "unrelated_images").map((issue) => ISSUE_MESSAGES[issue]);

  // `overallEvidence` is already known to be non-"sufficient" here (the
  // early return above caught that case) — always say SOMETHING, even
  // when no specific issue tag explains why, e.g. the model is unsure for
  // a reason `issues` doesn't capture (size ambiguity, an odd angle).
  if (messages.length === 0) {
    messages.push(
      evidence.coverage === "insufficient"
        ? "We can't tell how much of the property these photos show — a few more photos of each side would help."
        : evidence.coverage === "partial"
          ? "We don't have photos of every side of the property yet — a photo of the remaining side(s) would help."
          : "We're not fully confident in what we detected — a couple more photos would help us double-check.",
    );
  }

  return messages;
}
