import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Demo" };

export default function DemoPage() {
  return (
    <PlaceholderPage
      eyebrow="Coming in Phase 3"
      heading="The interactive analysis experience is coming soon."
    >
      <p>
        This page will let you explore a real Tallyvis property scan step by step&mdash;from a raw
        photo to detected job characteristics&mdash;interactively.
      </p>
      <p>
        For now, see the static preview in the &ldquo;See what Tallyvis sees&rdquo; section on the
        homepage.
      </p>
    </PlaceholderPage>
  );
}
