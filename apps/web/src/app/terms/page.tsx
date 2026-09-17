import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <PlaceholderPage eyebrow="Legal" heading="Terms of Service">
      <p>
        Tallyvis&rsquo;s terms of service are being drafted alongside the product. This placeholder
        will be replaced with complete terms before general availability.
      </p>
    </PlaceholderPage>
  );
}
