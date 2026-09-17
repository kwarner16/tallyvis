import Link from "next/link";
import { Container, buttonVariants } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <section className="bg-charcoal-950 py-24 text-paper">
      <Container>
        <Reveal className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Let your customers show you the job.
          </h2>
          <p className="text-lg text-paper/70">Turn photos into estimates before the site visit.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/estimator" className={buttonVariants({ variant: "primary" })}>
              Try the Estimator
            </Link>
            <Link href="/contact" className={buttonVariants({ variant: "outline-dark" })}>
              Talk to us
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
