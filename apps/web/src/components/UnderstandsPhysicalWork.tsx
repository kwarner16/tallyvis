import { Container } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

export function UnderstandsPhysicalWork() {
  return (
    <section className="bg-charcoal-950 py-28 text-paper">
      <Container>
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <span aria-hidden="true" className="h-1 w-12 rounded-full bg-accent" />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Software that understands physical work.
          </h2>
          <p className="text-lg leading-relaxed text-paper/70">
            Most business software understands transactions. Tallyvis is designed to understand the
            work itself.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
