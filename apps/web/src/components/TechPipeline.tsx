import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "Photos",
    description: "Customer-submitted images of the property.",
    tone: "plain",
  },
  {
    title: "Computer vision",
    description: "Models trained to recognize physical job features from images.",
    tone: "ai",
  },
  {
    title: "Job characteristics",
    description: "A structured, typed record: window count, type, stories, access, condition.",
    tone: "ai",
  },
  {
    title: "Pricing engine",
    description: "Deterministic, business-configured rules — no model involved.",
    tone: "pricing",
  },
  {
    title: "Estimate",
    description: "A price the customer can review and accept.",
    tone: "plain",
  },
] as const;

const TONE_STYLES: Record<(typeof STEPS)[number]["tone"], string> = {
  plain: "border-line bg-paper text-ink",
  ai: "border-line bg-paper-alt text-ink",
  pricing: "border-charcoal-line bg-charcoal-950 text-paper",
};

function ArrowDown() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="mx-auto h-5 w-5 text-ink-faint"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l-6-6m6 6l6-6" />
    </svg>
  );
}

export function TechPipeline() {
  return (
    <section id="technology" className="bg-paper-alt py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="Technical architecture"
            heading="One pipeline, two distinct systems."
            description="Vision and pricing are deliberately separate layers. The pricing engine never guesses, and the AI layer never touches a dollar amount."
            align="center"
          />
        </Reveal>

        <Reveal delayMs={100} className="mx-auto flex max-w-md flex-col">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col items-center">
              <div
                className={`w-full rounded-xl border px-6 py-4 text-center ${TONE_STYLES[step.tone]}`}
              >
                <p className="font-semibold">{step.title}</p>
                <p
                  className={`mt-1 text-sm ${step.tone === "pricing" ? "text-paper/70" : "text-ink-soft"}`}
                >
                  {step.description}
                </p>
              </div>
              {i < STEPS.length - 1 ? <ArrowDown /> : null}
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
