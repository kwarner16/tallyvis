import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@tallyvis/ui";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <section className="bg-paper py-16 sm:py-24">
      <Container className="mx-auto flex max-w-lg flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Get in touch</h1>
          <p className="text-base leading-relaxed text-ink-soft">
            Questions about pricing, onboarding your business, or anything else — send us a
            message and we&rsquo;ll reply by email.
          </p>
        </div>

        <ContactForm />

        <Link href="/" className="text-sm font-medium text-accent-strong hover:text-accent">
          &larr; Back to home
        </Link>
      </Container>
    </section>
  );
}
