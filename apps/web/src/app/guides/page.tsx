import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@tallyvis/ui";

const PATH = "/guides";
const TITLE = "Guides";
const DESCRIPTION = "Practical guides on estimating and quoting window cleaning jobs — from photo-based estimating to what AI can and can't reliably tell you.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

const GUIDES = [
  {
    href: "/guides/how-to-quote-window-cleaning-jobs-from-photos",
    title: "How to Quote Window Cleaning Jobs From Photos",
    description:
      "What to capture, how to count accurately, and when a site visit is still worth it.",
  },
  {
    href: "/guides/what-ai-can-and-cannot-see-in-property-photos",
    title: "What AI Can and Cannot Reliably Detect From Property Photos",
    description:
      "An honest look at where AI photo analysis is genuinely reliable, and where it isn't.",
  },
];

export default function GuidesIndexPage() {
  return (
    <section className="bg-paper py-16 sm:py-24">
      <Container className="mx-auto flex max-w-3xl flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Eyebrow>Guides</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{TITLE}</h1>
          <p className="text-base leading-relaxed text-ink-soft">{DESCRIPTION}</p>
        </div>

        <div className="flex flex-col divide-y divide-line border-y border-line">
          {GUIDES.map((guide) => (
            <Link key={guide.href} href={guide.href} className="group flex flex-col gap-1.5 py-6">
              <h2 className="text-lg font-semibold text-ink group-hover:text-accent-strong">
                {guide.title}
              </h2>
              <p className="text-sm leading-relaxed text-ink-soft">{guide.description}</p>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}
