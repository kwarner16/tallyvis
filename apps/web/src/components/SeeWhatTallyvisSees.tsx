import Link from "next/link";
import { Container, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { PropertyScanVisual } from "./PropertyScanVisual";
import { Reveal } from "./Reveal";

export function SeeWhatTallyvisSees() {
  return (
    <section id="see-what-tallyvis-sees" className="border-y border-line bg-paper-alt py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="The core product"
            heading="See what Tallyvis sees."
            description="Tallyvis turns ordinary property photos into structured job information — the same data a business's pricing rules run on."
          />
        </Reveal>

        <Reveal delayMs={100}>
          <PropertyScanVisual variant="full" />
        </Reveal>

        <Reveal
          delayMs={160}
          className="flex flex-col items-start gap-3 sm:flex-row sm:items-center"
        >
          <Link href="/demo" className={buttonVariants({ variant: "outline" })}>
            Explore the analysis
          </Link>
          <p className="text-sm text-ink-faint">
            The full interactive version of this experience is coming next.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
