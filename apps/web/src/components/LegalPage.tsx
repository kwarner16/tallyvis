import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@tallyvis/ui";

export interface LegalPageProps {
  eyebrow: string;
  heading: string;
  effectiveDate?: string;
  lastUpdated?: string;
  children: ReactNode;
}

/**
 * Shared layout for long-form legal/compliance pages (/privacy, /terms,
 * /data). Content is plain semantic HTML (h2/h3/p/ul/strong/a) — styling is
 * applied via descendant selectors below so page files can stay close to
 * the source policy text instead of repeating Tailwind classes per element.
 */
export function LegalPage({ eyebrow, heading, effectiveDate, lastUpdated, children }: LegalPageProps) {
  return (
    <section className="bg-paper py-16 sm:py-24">
      <Container className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="flex flex-col gap-3 border-b border-line pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{heading}</h1>
          {effectiveDate || lastUpdated ? (
            <div className="flex flex-col gap-1 text-sm text-ink-faint sm:flex-row sm:gap-4">
              {effectiveDate ? <p>Effective date: {effectiveDate}</p> : null}
              {lastUpdated ? <p>Last updated: {lastUpdated}</p> : null}
            </div>
          ) : null}
        </div>

        <div
          className="flex flex-col gap-4 text-base leading-relaxed text-ink-soft
            [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_h2:first-child]:mt-0
            [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink
            [&_p]:leading-relaxed
            [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6
            [&_li]:leading-relaxed
            [&_strong]:font-semibold [&_strong]:text-ink
            [&_a]:font-medium [&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent"
        >
          {children}
        </div>

        <Link href="/" className="text-sm font-medium text-accent-strong hover:text-accent">
          &larr; Back to home
        </Link>
      </Container>
    </section>
  );
}
