import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

const STEPS = [
  "Customer photo",
  "AI estimate",
  "Human adjustment",
  "Actual job",
  "Actual labor & outcome",
  "Better future estimates",
];

export function DataFlywheel() {
  return (
    <section id="data-flywheel" className="bg-paper py-24">
      <Container className="flex flex-col gap-10">
        <Reveal>
          <SectionHeading
            eyebrow="Long-term architecture"
            heading="A learning loop, not a one-time guess."
            description="Real job outcomes are designed to feed back into future estimates. This is the intended long-term architecture — Tallyvis is not claiming an existing proprietary dataset today."
          />
        </Reveal>

        <Reveal delayMs={100} className="flex flex-wrap items-center gap-x-2 gap-y-4">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-line bg-paper-alt px-4 py-2 text-sm font-medium text-ink">
                {step}
              </span>
              {i < STEPS.length - 1 ? (
                <span aria-hidden="true" className="text-accent">
                  &rarr;
                </span>
              ) : null}
            </div>
          ))}
        </Reveal>

        <Reveal delayMs={160} className="flex items-center gap-2 text-sm text-ink-faint">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-4 w-4 text-accent"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h5M20 20v-5h-5M4.5 9a8 8 0 0114.5-3.5M19.5 15a8 8 0 01-14.5 3.5"
            />
          </svg>
          Feeds back into future estimates.
        </Reveal>
      </Container>
    </section>
  );
}
