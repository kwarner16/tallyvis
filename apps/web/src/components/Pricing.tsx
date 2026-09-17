import Link from "next/link";
import { Container, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { Reveal } from "./Reveal";

const TIERS = [
  {
    name: "Starter",
    price: "$79",
    period: "/month",
    description: "For a single crew getting started with window-cleaning estimating.",
    features: ["Window cleaning estimating", "Core business dashboard", "Email support"],
    featured: false,
  },
  {
    name: "Growth",
    price: "$149",
    period: "/month",
    description: "For businesses ready to put quoting on their own website.",
    features: ["Everything in Starter", "Website embed widget", "Priority support"],
    featured: true,
  },
  {
    name: "Pro",
    price: "$299",
    period: "/month",
    description: "For multi-crew operations that need more visibility.",
    features: ["Everything in Growth", "Multiple locations", "Advanced reporting"],
    featured: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For larger operations with custom needs.",
    features: ["Custom integrations", "Dedicated support", "Custom SLAs"],
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-line bg-paper-alt py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="Early pricing"
            heading="Starting plans."
            description="Pricing reflects where the product is today and will evolve as Tallyvis grows. An onboarding fee may apply."
          />
        </Reveal>

        <Reveal delayMs={100} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col gap-6 rounded-2xl border p-6 ${
                tier.featured ? "border-accent bg-paper shadow-sm" : "border-line bg-paper"
              }`}
            >
              {tier.featured ? (
                <span className="w-fit rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-paper">
                  Most popular
                </span>
              ) : null}
              <div>
                <p className="text-lg font-semibold text-ink">{tier.name}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight text-ink">
                    {tier.price}
                  </span>
                  {tier.period ? (
                    <span className="text-sm text-ink-faint">{tier.period}</span>
                  ) : null}
                </p>
                <p className="mt-2 text-sm text-ink-soft">{tier.description}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-ink-soft">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-sm bg-accent"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.name === "Enterprise" ? "/contact" : "/estimator"}
                className={buttonVariants({
                  variant: tier.featured ? "primary" : "outline",
                  className: "w-full",
                })}
              >
                {tier.name === "Enterprise" ? "Talk to us" : "Get started"}
              </Link>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
