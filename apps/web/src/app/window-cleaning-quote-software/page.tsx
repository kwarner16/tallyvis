import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { JsonLdScript, breadcrumbListJsonLd } from "@/lib/structuredData";
import { SIGNUP_URL } from "@/lib/urls";

const PATH = "/window-cleaning-quote-software";
const TITLE = "Window Cleaning Quote Software";
const DESCRIPTION =
  "What to actually look for in window cleaning quote software, and how Tallyvis's photo-based, AI-assisted approach to estimating fits alongside the tools you already use.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

const CHECKLIST = [
  {
    title: "Does it actually speed up quoting, or just organize it?",
    body: "A lot of quoting software is really a form builder or a CRM field — useful, but it still requires someone to look at the property and decide the numbers. Photo-based AI estimating removes that step for routine jobs.",
  },
  {
    title: "Who controls the price?",
    body: "Pricing should always come from rules your business sets — base price, per-window rate, story surcharges, minimums — never a black-box number a vendor or an AI model decides on your behalf.",
  },
  {
    title: "What happens when the software is unsure?",
    body: "Every estimating tool gets some jobs wrong from limited information. The important question is whether it tells you (and the customer) when it's uncertain, or just presents a number with false confidence.",
  },
  {
    title: "Can customers actually use it from your own website?",
    body: "A quoting tool that only lives in your internal dashboard doesn't generate leads by itself. An embeddable estimator on your own site turns “Get a quote” into an actual submission, not a phone-tag cycle.",
  },
];

const FAQS = [
  {
    question: "Is Tallyvis a full CRM or scheduling platform?",
    answer:
      "No — Tallyvis is focused specifically on photo-based estimating and quoting, embedded on your own website. It's built to fit alongside whatever scheduling, invoicing, or CRM tools you already use, not replace them.",
  },
  {
    question: "Do I need to change my pricing to use it?",
    answer:
      "No. You configure your own pricing rules (base price, per-window rate, surcharges, minimums, and more) and Tallyvis calculates every estimate against them — it never sets or suggests a price on its own.",
  },
  {
    question: "How is this different from a generic online quote form?",
    answer:
      "A generic form still requires someone to manually review photos and decide the job details. Tallyvis's AI proposes those details automatically from the photos, flags what it's unsure about, and only then applies your pricing rules.",
  },
];

export default function WindowCleaningQuoteSoftwarePage() {
  return (
    <>
      <JsonLdScript data={breadcrumbListJsonLd([{ name: TITLE, path: PATH }])} />
      <section className="bg-paper py-16 sm:py-24">
        <Container className="mx-auto flex max-w-3xl flex-col gap-6">
          <Eyebrow>Quoting software</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            What to look for in window cleaning quote software
          </h1>
          <p className="text-lg leading-relaxed text-ink-soft">{DESCRIPTION}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={SIGNUP_URL} className={buttonVariants({ variant: "primary" })}>
              Start free
            </Link>
            <Link href="/ai-window-cleaning-estimator" className={buttonVariants({ variant: "outline" })}>
              See how Tallyvis works
            </Link>
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-paper-alt py-16 sm:py-24">
        <Container className="flex flex-col gap-12">
          <SectionHeading eyebrow="A short checklist" heading="Four questions worth asking before you pick one" />
          <div className="grid gap-6 sm:grid-cols-2">
            {CHECKLIST.map((item) => (
              <div key={item.title} className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-6">
                <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-paper py-16 sm:py-24">
        <Container className="mx-auto flex max-w-2xl flex-col gap-4">
          <SectionHeading
            eyebrow="Where Tallyvis fits"
            heading="Estimating and quoting — not a full CRM"
            description="Tallyvis embeds a photo-based, AI-assisted estimator on your own website. It's deliberately focused: it doesn't try to replace your scheduling or invoicing tools, it gives them a faster, more accurate quote to start from."
          />
          <p className="text-base leading-relaxed text-ink-soft">
            See exactly how the estimating flow works in{" "}
            <Link href="/ai-window-cleaning-estimator" className="font-medium text-accent-strong hover:text-accent">
              the AI window cleaning estimator page
            </Link>
            , or read{" "}
            <Link href="/guides/how-to-quote-window-cleaning-jobs-from-photos" className="font-medium text-accent-strong hover:text-accent">
              how to quote window cleaning jobs from photos
            </Link>{" "}
            for the underlying method, AI-assisted or not.
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
            Quote requests, straight from your own website.
          </h2>
          <Link href={SIGNUP_URL} className={buttonVariants({ variant: "primary" })}>
            Start free
          </Link>
        </Container>
      </section>
    </>
  );
}
