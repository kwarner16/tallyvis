import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

const LEVELS = [
  {
    label: "High confidence",
    action: "Estimate automatically",
    emphasis: "strong",
  },
  {
    label: "Medium confidence",
    action: "Business review recommended",
    emphasis: "medium",
  },
  {
    label: "Low confidence",
    action: "Request more information",
    emphasis: "low",
  },
] as const;

const EMPHASIS_STYLES: Record<(typeof LEVELS)[number]["emphasis"], string> = {
  strong: "border-accent bg-accent-soft",
  medium: "border-line bg-paper-alt",
  low: "border-line bg-paper",
};

export function Confidence() {
  return (
    <section id="confidence" className="bg-paper py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="Product philosophy"
            heading="Tallyvis knows when it doesn't know."
            description="This is the confidence-aware architecture Tallyvis is designed around — it becomes more capable as the underlying computer-vision model matures, not a claim about production accuracy today."
          />
        </Reveal>

        <Reveal delayMs={100} className="grid gap-6 sm:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level.label}
              className={`flex flex-col gap-3 rounded-2xl border p-6 ${EMPHASIS_STYLES[level.emphasis]}`}
            >
              <span aria-hidden="true" className="h-1.5 w-8 rounded-full bg-accent" />
              <p className="text-base font-semibold text-ink">{level.label}</p>
              <p className="text-sm text-ink-soft">{level.action}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
