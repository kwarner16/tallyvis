import Link from "next/link";
import { PLANS } from "@tallyvis/config";
import { Container, SectionHeading, buttonVariants } from "@tallyvis/ui";
import { Reveal } from "./Reveal";
import { SIGNUP_URL } from "@/lib/urls";

/**
 * Phase 14 (see docs/decisions/0016-onboarding-billing-embed.md) — the
 * three real self-serve tiers come from `@tallyvis/config`'s `PLANS`, the
 * single authoritative plan definition apps/app's onboarding/billing also
 * reads, so a price or feature list can never drift between the two.
 * "Enterprise" isn't a self-serve plan (it isn't in `PLANS`), so it stays
 * a plain contact-sales card pointing at /contact, exactly as before.
 * Every "Get started" link now goes to signup with the chosen plan
 * preserved (`?plan=...`) — `apps/app`'s signup page carries it through to
 * the dashboard's onboarding prompt, which preselects it.
 */

const ENTERPRISE_TIER = {
  name: "Enterprise",
  price: "Custom",
  description: "For larger operations with custom needs.",
  features: ["Custom integrations", "Dedicated support", "Custom SLAs"],
};

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-line bg-paper-alt py-24">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            eyebrow="Early pricing"
            heading="Starting plans."
            description="Every plan includes a 7-day free trial. Pricing reflects where the product is today and will evolve as Tallyvis grows. A one-time website installation fee may apply."
          />
        </Reveal>

        <Reveal delayMs={100} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col gap-6 rounded-2xl border p-6 ${
                plan.featured ? "border-accent bg-paper shadow-sm" : "border-line bg-paper"
              }`}
            >
              {plan.featured ? (
                <span className="w-fit rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-paper">
                  Most popular
                </span>
              ) : null}
              <div>
                <p className="text-lg font-semibold text-ink">{plan.name}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight text-ink">
                    ${(plan.monthlyPriceCents / 100).toFixed(0)}
                  </span>
                  <span className="text-sm text-ink-faint">/month</span>
                </p>
                <p className="mt-2 text-sm text-ink-soft">{plan.description}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-ink-soft">
                {plan.features.map((feature) => (
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
                href={`${SIGNUP_URL}?plan=${plan.id}`}
                className={buttonVariants({
                  variant: plan.featured ? "primary" : "outline",
                  className: "w-full",
                })}
              >
                Get started
              </Link>
            </div>
          ))}

          <div className="flex flex-col gap-6 rounded-2xl border border-line bg-paper p-6">
            <div>
              <p className="text-lg font-semibold text-ink">{ENTERPRISE_TIER.name}</p>
              <p className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight text-ink">
                  {ENTERPRISE_TIER.price}
                </span>
              </p>
              <p className="mt-2 text-sm text-ink-soft">{ENTERPRISE_TIER.description}</p>
            </div>
            <ul className="flex flex-1 flex-col gap-2 text-sm text-ink-soft">
              {ENTERPRISE_TIER.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-sm bg-accent" />
                  {feature}
                </li>
              ))}
            </ul>
            <Link href="/contact" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              Talk to us
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
