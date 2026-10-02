import type { Metadata } from "next";
import { Container, Eyebrow, SectionHeading } from "@tallyvis/ui";
import { CreatorApplicationForm } from "@/components/CreatorApplicationForm";

const PATH = "/creators";
const TITLE = "Founding Creator Program";
const DESCRIPTION =
  "TallyVis partners with window-cleaning and home-service creators: 20% recurring commission on referred customers for their first 12 months, complimentary TallyVis access while you're an active creator, and a direct line to the team building the product.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

const BENEFITS = [
  {
    title: "20% recurring commission",
    body: "Earn 20% of the recurring subscription revenue collected from each business you refer — for that customer's first 12 months. This is a separate benefit from complimentary access below, and keeps paying out for existing referrals even if your own active-creator status later changes.",
  },
  {
    title: "Complimentary TallyVis access",
    body: "If you run your own window-cleaning business, use TallyVis at no cost for as long as you're an active founding creator — defined simply as posting at least one piece of real TallyVis content per month. No view or follower minimums.",
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
              share your link, and earn a 20% recurring commission on each referred customer&rsquo;s first 12 months.
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
            TallyVis is an early-stage company and we don&rsquo;t promise any particular level of earnings — actual
            commission depends entirely on the business you refer and how long they stay a customer. Recurring
            commission and complimentary access are the standard founding-creator benefits described above; a
            separate paid sponsorship (e.g. a one-off video fee) is never automatic and would only ever happen
            under its own, separately agreed terms. Full commission and eligibility terms are set out in the
            program agreement shared with each partner.
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
