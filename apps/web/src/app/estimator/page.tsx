import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Estimator" };

export default function EstimatorPage() {
  return (
    <PlaceholderPage eyebrow="Customer estimator" heading="The Tallyvis estimator isn't live yet.">
      <p>
        The customer-facing photo-to-quote workflow is planned for an upcoming phase of development.
      </p>
      <p>
        Check back soon, or explore how the pricing and analysis pieces fit together on the
        homepage.
      </p>
    </PlaceholderPage>
  );
}
