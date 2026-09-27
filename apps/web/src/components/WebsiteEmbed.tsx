import { Container, SectionHeading } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

/**
 * A distinct "host business" brand color (not Tallyvis's own orange accent)
 * — the whole point of this mock is showing that an embedded estimator
 * takes on the EMBEDDING business's colors, not Tallyvis's. Matches how the
 * real embed works: apps/app's StepShell applies a business's brand color
 * as CSS custom properties (see @tallyvis/config's deriveEstimatorTheme),
 * with a small "Powered by Tallyvis" credit left deliberately subtle — see
 * StepShell's own PoweredByTallyvis comment. This mock is illustrative
 * (a fixed color, not wired to deriveEstimatorTheme), but the visual
 * language is the same real behavior, not a fabricated capability.
 */
const DEMO_BUSINESS_BRAND = "#1d6f5c";

export function WebsiteEmbed() {
  return (
    <section id="website-embed" className="border-t border-line bg-paper-alt py-24">
      <Container className="grid items-center gap-16 lg:grid-cols-2">
        <Reveal>
          <SectionHeading
            eyebrow="Distribution"
            heading="Your website. Your colors. Powered by Tallyvis."
            description="The estimator lives inside your own website, styled in your brand colors — the customer never has to leave your site, and never has to know Tallyvis is behind it unless you want them to."
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
              acmewindowcleaning.com
            </span>
          </div>

          <div className="flex flex-col gap-4 p-6">
            <p
              className="text-xs font-semibold uppercase tracking-[0.15em]"
              style={{ color: DEMO_BUSINESS_BRAND }}
            >
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
                className="rounded-lg px-4 py-2 text-sm font-semibold text-paper transition-opacity hover:opacity-90"
                style={{ backgroundColor: DEMO_BUSINESS_BRAND }}
              >
                Upload photos
              </button>
              <p className="text-xs text-ink-faint">JPG or PNG, a few photos of the property</p>
            </div>

            <p className="text-center text-[11px] text-ink-faint/70">Powered by Tallyvis</p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
