import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Eyebrow } from "@tallyvis/ui";
import { JsonLdScript, articleJsonLd, breadcrumbListJsonLd } from "@/lib/structuredData";

export interface ArticleLayoutProps {
  title: string;
  description: string;
  path: string;
  datePublished: string;
  children: ReactNode;
}

/**
 * Shared layout for Tallyvis's educational content (`/guides/*`) — mirrors
 * `LegalPage.tsx`'s pattern of plain semantic HTML content styled via
 * descendant selectors, so an article's body can stay close to the source
 * text. See docs/decisions/0028-mobile-sms-embed-and-growth-updates.md:
 * "quality over quantity" — this exists for a small, hand-written set of
 * cornerstone articles, not a CMS/MDX pipeline for mass content generation.
 */
export function ArticleLayout({ title, description, path, datePublished, children }: ArticleLayoutProps) {
  return (
    <section className="bg-paper py-16 sm:py-24">
      <JsonLdScript data={articleJsonLd({ title, description, path, datePublished })} />
      <JsonLdScript data={breadcrumbListJsonLd([{ name: "Guides", path: "/guides" }, { name: title, path }])} />
      <Container className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="flex flex-col gap-3 border-b border-line pb-8">
          <Link href="/guides" className="w-fit text-sm font-medium text-ink-faint hover:text-ink">
            &larr; All guides
          </Link>
          <Eyebrow>Guide</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
          <p className="text-base leading-relaxed text-ink-soft">{description}</p>
        </div>

        <div
          className="flex flex-col gap-4 text-base leading-relaxed text-ink-soft
            [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_h2:first-child]:mt-0
            [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink
            [&_p]:leading-relaxed
            [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6
            [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6
            [&_li]:leading-relaxed
            [&_strong]:font-semibold [&_strong]:text-ink
            [&_a]:font-medium [&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent"
        >
          {children}
        </div>
      </Container>
    </section>
  );
}
