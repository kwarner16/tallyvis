import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

export function WebsiteEmbed() {
  return (
    <section id="website-embed" className="border-t border-line bg-paper-alt py-24">
      <Container className="grid items-center gap-16 lg:grid-cols-2">
        <Reveal>
          <SectionHeading
            eyebrow="Distribution"
            heading="Your website becomes the quote experience."
            description="Tallyvis can become the instant-quote widget on a service business's own website — so a customer gets an estimate the moment they land, not days after a phone call."
          />
        </Reveal>

        <Reveal
          delayMs={120}
          className="overflow-hidden rounded-2xl border border-line bg-paper shadow-sm"
        >
          <div className="flex items-center gap-2 border-b border-line bg-paper-alt px-4 py-3">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-line" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-line" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="ml-3 rounded-md bg-paper px-3 py-1 text-xs text-ink-faint">
              yourcompany.com
            </span>
          </div>

          <div className="flex flex-col gap-4 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-strong">
              Get an instant quote
            </p>
            <p className="text-sm text-ink-soft">Tell us about your property.</p>

            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-paper-alt px-6 py-8 text-center">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-8 w-8 text-ink-faint"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 9l5-5 5 5M12 4v12"
                />
              </svg>
              <button
                type="button"
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-strong-hover"
              >
                Upload photos
              </button>
              <p className="text-xs text-ink-faint">JPG or PNG, a few photos of the property</p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
