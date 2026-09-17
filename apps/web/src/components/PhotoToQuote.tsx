import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

const STAGES = [
  {
    index: "01",
    title: "Photo",
    description: "The customer uploads photos of the property — no site visit required yet.",
  },
  {
    index: "02",
    title: "Vision",
    description: "Tallyvis analyzes the images to identify the physical details of the job.",
  },
  {
    index: "03",
    title: "Understanding",
    description:
      "Tallyvis identifies structured job characteristics: window count, type, stories, access, and more.",
  },
  {
    index: "04",
    title: "Estimate",
    description: "The business's own pricing rules turn those characteristics into a quote.",
  },
];

export function PhotoToQuote() {
  return (
    <section id="from-photo-to-quote" className="bg-paper py-24">
      <Container className="flex flex-col gap-16">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            heading="From photo to quote."
            description="One continuous pipeline turns a handful of photos into a real, business-configured price."
          />
        </Reveal>

        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 top-5 hidden h-px bg-line lg:block"
          />
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {STAGES.map((stage, i) => (
              <Reveal key={stage.index} delayMs={i * 90}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent bg-paper text-sm font-semibold text-accent-strong"
                    >
                      {stage.index}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint lg:hidden">
                      Stage {stage.index}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-ink">{stage.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-soft">{stage.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
