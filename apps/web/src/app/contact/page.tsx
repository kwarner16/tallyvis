import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <PlaceholderPage eyebrow="Contact" heading="Get in touch">
      <p>A direct contact channel isn&rsquo;t wired up yet.</p>
      <p>
        In the meantime, take a look at the pricing and estimator pages to see where Tallyvis is
        headed.
      </p>
    </PlaceholderPage>
  );
}
