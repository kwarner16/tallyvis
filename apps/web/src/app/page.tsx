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

export default function Home() {
  return (
    <>
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
