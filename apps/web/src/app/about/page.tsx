import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <PlaceholderPage eyebrow="About" heading="About Tallyvis">
      <p>
        Tallyvis is an early-stage company building an AI visual estimating and quoting platform for
        physical service businesses, starting with residential window cleaning.
      </p>
      <p>
        The core idea: AI determines what a job involves&mdash;window count, type, stories, access,
        and more&mdash;and the business&rsquo;s own pricing rules determine what it costs. AI never
        invents the price.
      </p>
      <p>
        Tallyvis is under active development. This site reflects the current state of the product,
        including features that are still being built.
      </p>
    </PlaceholderPage>
  );
}
