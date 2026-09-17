import { Container, SectionHeading } from "@tallyvis/ui";
import { CountUp, type CountUpFormat } from "./CountUp";
import { Reveal } from "./Reveal";

const STATS: { label: string; value: number; format: CountUpFormat }[] = [
  { label: "Quotes this month", value: 128, format: "number" },
  { label: "Average estimate", value: 246, format: "currency" },
  { label: "Conversion rate", value: 62, format: "percent" },
  { label: "Estimated revenue", value: 31400, format: "currency" },
];

const QUOTES = [
  { address: "142 Maple St", windows: 24, amount: "$312", status: "New" },
  { address: "88 Birchwood Ave", windows: 18, amount: "$248", status: "Review" },
  { address: "310 Oak Ridge Dr", windows: 32, amount: "$410", status: "Sent" },
  { address: "77 Pine Ct", windows: 14, amount: "$198", status: "Accepted" },
] as const;

const STATUS_STYLES: Record<(typeof QUOTES)[number]["status"], string> = {
  New: "border border-accent/40 bg-accent-soft text-accent-strong",
  Review: "border border-line bg-paper text-ink-soft",
  Sent: "border border-charcoal-line bg-transparent text-paper/80",
  Accepted: "bg-paper text-charcoal-950",
};

export function BusinessDashboard() {
  return (
    <section id="dashboard" className="bg-charcoal-950 py-24 text-paper">
      <Container className="flex flex-col gap-12">
        <Reveal>
          <SectionHeading
            tone="dark"
            eyebrow="Operational software"
            heading="More than an AI demo."
            description="Every estimate lands in a real dashboard the business runs their day from."
          />
        </Reveal>

        <Reveal delayMs={100} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-charcoal-line bg-charcoal-900 p-6"
            >
              <p className="text-3xl font-semibold tracking-tight">
                <CountUp value={stat.value} format={stat.format} />
              </p>
              <p className="mt-2 text-sm text-paper/60">{stat.label}</p>
            </div>
          ))}
        </Reveal>

        <Reveal delayMs={160} className="overflow-hidden rounded-2xl border border-charcoal-line">
          <div className="flex items-center justify-between border-b border-charcoal-line bg-charcoal-900 px-6 py-4">
            <p className="text-sm font-medium text-paper/80">Recent quotes</p>
            <p className="text-xs text-paper/40">Example dashboard preview</p>
          </div>
          <div className="divide-y divide-charcoal-line">
            {QUOTES.map((quote) => (
              <div
                key={quote.address}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-paper">{quote.address}</span>
                  <span className="text-xs text-paper/50">{quote.windows} windows</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-paper/80">{quote.amount}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[quote.status]}`}
                  >
                    {quote.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <p className="text-xs text-paper/40">
          Illustrative example data for product-preview purposes — not real customer results.
        </p>
      </Container>
    </section>
  );
}
