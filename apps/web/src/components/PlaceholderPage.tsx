import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@tallyvis/ui";

export interface PlaceholderPageProps {
  eyebrow: string;
  heading: string;
  children: ReactNode;
}

/** Honest "not built yet" pages for routes the nav/footer/CTAs link to that have no real destination until a later phase. */
export function PlaceholderPage({ eyebrow, heading, children }: PlaceholderPageProps) {
  return (
    <section className="bg-paper py-24">
      <Container className="mx-auto flex max-w-2xl flex-col gap-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{heading}</h1>
        <div className="flex flex-col gap-4 text-base leading-relaxed text-ink-soft">
          {children}
        </div>
        <Link href="/" className="text-sm font-medium text-accent-strong hover:text-accent">
          &larr; Back to home
        </Link>
      </Container>
    </section>
  );
}
