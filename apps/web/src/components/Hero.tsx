import Link from "next/link";
import { Container, buttonVariants } from "@tallyvis/ui";
import { HeroPreview } from "./HeroPreview";
import { SIGNUP_URL } from "@/lib/urls";

export function Hero() {
  return (
    <section className="border-b border-line bg-paper py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
            For service businesses
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Turn customer photos into quotes.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-ink-soft">
            Tallyvis embeds on your website, analyzes the photos your customers upload, helps
            collect the job details, and turns it all into an estimate&mdash;priced using your own
            rules, not ours.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href={SIGNUP_URL} className={buttonVariants({ variant: "primary" })}>
              Start free
            </a>
            <Link href="#from-photo-to-quote" className={buttonVariants({ variant: "outline" })}>
              See how it works
            </Link>
          </div>
        </div>

        <HeroPreview />
      </Container>
    </section>
  );
}
