import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <PlaceholderPage eyebrow="Legal" heading="Privacy Policy">
      <p>
        Tallyvis&rsquo;s privacy policy is being drafted alongside the product. This placeholder
        will be replaced with a complete policy before any real customer data is collected.
      </p>
    </PlaceholderPage>
  );
}
