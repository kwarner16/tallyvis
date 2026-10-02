import type { Metadata } from "next";
import { Container, Eyebrow, SectionHeading } from "@tallyvis/ui";
import { CreatorApplicationForm } from "@/components/CreatorApplicationForm";

const PATH = "/creators";
const TITLE = "Founding Creator Program";
const DESCRIPTION =
  "TallyVis partners with window-cleaning and home-service creators: free access while partnered, recurring referral commissions, and a direct line to the team building the product.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

const BENEFITS = [
  {
    title: "Free access while partnered",
    body: "Active founding creators who run their own window-cleaning business can use TallyVis at no cost while actively partnered, subject to the program's terms.",
  },
  {
    title: "Recurring affiliate commissions",
    body: "Earn a recurring commission on the subscription revenue from businesses you refer — for the first 12 months of each referred customer's subscription.",
  },
  {
    title: "Early access to features",
    body: "See and try what TallyVis is building before it ships publicly.",
  },
  {
    title: "A direct line to the team",
    body: "Talk directly with Kyle and the TallyVis team — not a support queue.",
  },
  {
    title: "A real say in the product",
    body: "Founding creators' feedback genuinely shapes what TallyVis builds next.",
  },
  {
    title: "Your own referral link",
    body: "A clean, unique link (tallyvis.com/r/yourcode) to share with your audience, with attribution that survives a 30-day window.",
  },
];

export default function CreatorsPage() {
  return (
    <>
      <section className="bg-charcoal-950 py-20 text-paper sm:py-28">
        <Container>
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <Eyebrow className="text-accent">Founding Creator Program</Eyebrow>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Build the future of estimating with TallyVis.
            </h1>
            <p className="text-lg text-paper/70">
              For creators who educate window-cleaning and home-service business owners — partner with TallyVis,
              share your link, and earn recurring commissions as the businesses you refer grow with us.
            </p>
            <a href="#apply" className="rounded-lg bg-accent-strong px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-strong-hover">
              Apply to the program
            </a>
          </div>
        </Container>
      </section>

      <section className="bg-paper py-16 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="Why partner with TallyVis"
            heading="What founding creators get"
            align="center"
            className="mx-auto"
          />
          <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="rounded-2xl border border-line bg-paper-alt p-6">
                <h3 className="text-base font-semibold text-ink">{benefit.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{benefit.body}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-ink-faint">
            TallyVis is an early-stage company. We don&rsquo;t make specific income claims — commission and
            access terms are set out in the program agreement shared with each partner. Future paid sponsorship
            opportunities may also become available as the program grows.
          </p>
        </Container>
      </section>

      <section id="apply" className="bg-paper-alt py-16 sm:py-24">
        <Container className="mx-auto flex max-w-lg flex-col gap-8">
          <div className="flex flex-col gap-3 text-center">
            <Eyebrow>Apply</Eyebrow>
            <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Join the program</h2>
            <p className="text-base leading-relaxed text-ink-soft">
              Tell us about your audience — Kyle reviews every application personally.
            </p>
          </div>
          <CreatorApplicationForm />
        </Container>
      </section>
    </>
  );
}
