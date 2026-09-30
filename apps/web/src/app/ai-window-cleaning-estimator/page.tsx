import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { JsonLdScript, breadcrumbListJsonLd } from "@/lib/structuredData";
import { ESTIMATOR_URL, SIGNUP_URL } from "@/lib/urls";

const PATH = "/ai-window-cleaning-estimator";
const TITLE = "AI Window Cleaning Estimator";
const DESCRIPTION =
  "Tallyvis is an AI window cleaning estimator that turns customer photos into a priced estimate — using your own pricing rules, with uncertainty surfaced instead of hidden.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

const STEPS = [
  {
    title: "Customer uploads photos",
    body: "A homeowner visits your own website, takes or uploads a few photos of the property, and answers a couple of quick questions — no app to install, no account to create.",
  },
  {
    title: "AI analyzes the job",
    body: "Tallyvis's vision model estimates window count, type, stories, and access from the photos, and flags anything it isn't confident about rather than guessing silently.",
  },
  {
    title: "Uncertain details get confirmed",
    body: "Low-confidence fields are shown clearly and confirmed — by the customer in the moment, or by you when you review it — before any price is calculated.",
  },
  {
    title: "Your pricing rules set the price",
    body: "The confirmed job characteristics run through the pricing rules you configure — base price, per-window rate, story surcharges, screens, tracks, hard water treatment, minimums. The AI never invents a number.",
  },
];

const FAQS = [
  {
    question: "Does the AI just make up a price on its own?",
    answer:
      "No. The AI only ever produces job characteristics — window count, type, stories, and similar details. Pricing always comes from your own configured rules, calculated the same way every time.",
  },
  {
    question: "What if the AI gets something wrong?",
    answer:
      "It's designed to flag what it's unsure about instead of hiding it. Low-confidence details get surfaced for confirmation before a quote is finalized, and you can always review or correct a quote in your dashboard.",
  },
  {
    question: "Does this replace me looking at the job at all?",
    answer:
      "For most routine jobs, no site visit is needed before quoting. For anything the photos don't clearly show, the estimator says so rather than guessing — you decide whether that one needs a closer look.",
  },
];

export default function AiWindowCleaningEstimatorPage() {
  return (
    <>
      <JsonLdScript data={breadcrumbListJsonLd([{ name: TITLE, path: PATH }])} />
      <section className="bg-paper py-16 sm:py-24">
        <Container className="mx-auto flex max-w-3xl flex-col gap-6">
          <Eyebrow>AI estimating</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            An AI window cleaning estimator that shows its work
          </h1>
          <p className="text-lg leading-relaxed text-ink-soft">
            {DESCRIPTION}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={SIGNUP_URL} className={buttonVariants({ variant: "primary" })}>
              Start free
            </Link>
            <a href={ESTIMATOR_URL} className={buttonVariants({ variant: "outline" })}>
              Try the live demo
            </a>
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-paper-alt py-16 sm:py-24">
        <Container className="flex flex-col gap-12">
          <SectionHeading eyebrow="How it works" heading="From photo to priced estimate" />
          <div className="grid gap-6 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <div key={step.title} className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-6">
                <span className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                  Step {index + 1}
                </span>
                <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-paper py-16 sm:py-24">
        <Container className="mx-auto flex max-w-2xl flex-col gap-4">
          <SectionHeading
            eyebrow="Honest about limits"
            heading="What the AI can and can't reliably tell"
            description="Clearly visible, well-photographed windows are analyzed confidently. Obstructed views, glare, and sides of the property that weren't photographed are flagged as uncertain rather than guessed at."
          />
          <p className="text-base leading-relaxed text-ink-soft">
            Read the full breakdown in{" "}
            <Link href="/guides/what-ai-can-and-cannot-see-in-property-photos" className="font-medium text-accent-strong hover:text-accent">
              what AI can and cannot reliably detect from property photos
            </Link>
            , or see{" "}
            <Link href="/window-cleaning-quote-software" className="font-medium text-accent-strong hover:text-accent">
              how Tallyvis compares to other quoting software
            </Link>
            .
          </p>
        </Container>
      </section>

      <section className="border-t border-line bg-paper-alt py-16 sm:py-24">
        <Container className="mx-auto flex max-w-2xl flex-col gap-8">
          <SectionHeading eyebrow="FAQ" heading="Common questions" />
          <div className="flex flex-col gap-6">
            {FAQS.map((faq) => (
              <div key={faq.question} className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold text-ink">{faq.question}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{faq.answer}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-paper py-16 sm:py-24">
        <Container className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Let your customers show you the job.
          </h2>
          <Link href={SIGNUP_URL} className={buttonVariants({ variant: "primary" })}>
            Start free
          </Link>
        </Container>
      </section>
    </>
  );
}
