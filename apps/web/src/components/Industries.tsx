import { Container, SectionHeading } from "@tallyvis/ui";
import { verticals } from "@tallyvis/config";
import { Reveal } from "./Reveal";

const activeVertical = Object.values(verticals).find((v) => v.status === "active");
const plannedVerticals = Object.values(verticals).filter((v) => v.status === "planned");

export function Industries() {
  return (
    <section id="industries" className="bg-paper py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="Industries"
            heading="Starting with window cleaning. Built for everything that comes next."
            description="Tallyvis's architecture separates the vision layer from vertical-specific job characteristics and pricing rules — which is what makes new industries additive, not a rewrite."
          />
        </Reveal>

        <Reveal delayMs={100} className="flex flex-col gap-6">
          {activeVertical ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent bg-accent-soft px-6 py-5">
              <div>
                <p className="text-lg font-semibold text-ink">{activeVertical.label}</p>
                <p className="text-sm text-ink-soft">Available now</p>
              </div>
              <span className="rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-paper">
                Live
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {plannedVerticals.map((vertical) => (
              <div
                key={vertical.key}
                className="flex flex-col gap-1 rounded-xl border border-line bg-paper-alt px-4 py-4"
              >
                <p className="text-sm font-medium text-ink-soft">{vertical.label}</p>
                <p className="text-xs text-ink-faint">Planned</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
