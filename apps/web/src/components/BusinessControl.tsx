import { Container, SectionHeading } from "@tallyvis/ui";
import { windowCleaningDefaultPricingRules as rules } from "@tallyvis/config";
import { Reveal } from "./Reveal";

const PRICING_ROWS = [
  { label: "Base price", value: `$${rules.basePrice}` },
  { label: "Per window", value: `$${rules.pricePerWindow}` },
  { label: "Second story", value: `+$${rules.secondStorySurcharge}` },
  { label: "Screens", value: `$${rules.screenCleaningPrice} each` },
  { label: "Track cleaning", value: `$${rules.trackCleaningPrice} each` },
  { label: "Minimum job", value: `$${rules.minimumJobPrice}` },
];

export function BusinessControl() {
  return (
    <section id="business-control" className="bg-paper py-24">
      <Container className="grid items-center gap-16 lg:grid-cols-2">
        <Reveal>
          <SectionHeading
            eyebrow="Architecture"
            heading="You set the rules. AI does the work."
            description="Tallyvis's AI determines what a job actually involves. It never decides what that job is worth. Every business defines its own pricing model, and Tallyvis applies it consistently to every estimate."
          />
        </Reveal>

        <Reveal delayMs={120}>
          <div className="rounded-2xl border border-line bg-paper-alt p-6">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">
                Pricing rules
              </p>
              <span className="rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink-soft">
                Window Cleaning
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {PRICING_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg bg-paper px-4 py-3"
                >
                  <span className="text-sm text-ink-soft">{row.label}</span>
                  <span className="rounded-md bg-paper-alt px-3 py-1 font-mono text-sm text-ink">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              Illustrative pricing-rule interface. Businesses configure their own values.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
