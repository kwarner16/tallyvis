import type { Metadata } from "next";
import { Hero } from "@/components/Hero";
import { PhotoToQuote } from "@/components/PhotoToQuote";
import { SeeWhatTallyvisSees } from "@/components/SeeWhatTallyvisSees";
import { BusinessControl } from "@/components/BusinessControl";
import { BusinessDashboard } from "@/components/BusinessDashboard";
import { Confidence } from "@/components/Confidence";
import { WebsiteEmbed } from "@/components/WebsiteEmbed";
import { Industries } from "@/components/Industries";
import { TechPipeline } from "@/components/TechPipeline";
import { DataFlywheel } from "@/components/DataFlywheel";
import { UnderstandsPhysicalWork } from "@/components/UnderstandsPhysicalWork";
import { Pricing } from "@/components/Pricing";
import { FinalCta } from "@/components/FinalCta";
import { JsonLdScript, softwareApplicationJsonLd } from "@/lib/structuredData";

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) — previously
 * relied entirely on the root layout's default title/description. An
 * explicit canonical here also matters since this is the page every other
 * route's internal links ultimately point back to.
 */
export const metadata: Metadata = {
  title: "AI-Assisted Window Cleaning Estimates From Customer Photos",
  description:
    "Tallyvis embeds on your window cleaning website, analyzes the photos your customers upload, and turns them into an estimate — priced using your own rules, reviewed before it reaches a customer.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <JsonLdScript data={softwareApplicationJsonLd()} />
      <Hero />
      <PhotoToQuote />
      <SeeWhatTallyvisSees />
      <BusinessControl />
      <BusinessDashboard />
      <Confidence />
      <WebsiteEmbed />
      <Industries />
      <TechPipeline />
      <DataFlywheel />
      <UnderstandsPhysicalWork />
      <Pricing />
      <FinalCta />
    </>
  );
}
