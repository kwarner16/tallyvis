import Link from "next/link";
import { Container, buttonVariants } from "@tallyvis/ui";
import { PropertyScanVisual } from "./PropertyScanVisual";

export function Hero() {
  return (
    <section className="border-b border-line bg-paper py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
            Photo &rarr; Vision &rarr; Understanding &rarr; Estimate
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Your job. Seen differently.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-ink-soft">
            Tallyvis turns customer photos into intelligent, business-specific estimates&mdash;so
            service businesses can quote more jobs without manually inspecting every property.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="#see-what-tallyvis-sees" className={buttonVariants({ variant: "primary" })}>
              See It In Action
            </Link>
            <Link href="#pricing" className={buttonVariants({ variant: "outline" })}>
              Get Started
            </Link>
          </div>
        </div>

        <PropertyScanVisual variant="compact" />
      </Container>
    </section>
  );
}
