import Link from "next/link";
import { Container } from "@tallyvis/ui";

const PRODUCT_LINKS = [
  { label: "Product", href: "/#see-what-tallyvis-sees" },
  { label: "How It Works", href: "/#from-photo-to-quote" },
  { label: "Industries", href: "/#industries" },
  { label: "Pricing", href: "/#pricing" },
  { label: "About", href: "/about" },
];

const LEGAL_LINKS = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Manage Your Data", href: "/data" },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper-alt">
      <Container className="grid gap-10 py-16 sm:grid-cols-2 md:grid-cols-4">
        <div className="flex flex-col gap-3 sm:col-span-2 md:col-span-1">
          <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
            Tallyvis
          </span>
          <p className="max-w-xs text-sm text-ink-soft">Your job. Seen differently.</p>
        </div>

        <nav aria-label="Footer product" className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">
            Product
          </p>
          {PRODUCT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Footer contact" className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">
            Contact
          </p>
          <Link href="/contact" className="text-sm text-ink-soft transition-colors hover:text-ink">
            Contact
          </Link>
        </nav>

        <nav aria-label="Footer legal" className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">Legal</p>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </Container>

      <Container className="border-t border-line py-6">
        <p className="text-xs text-ink-faint">
          &copy; {new Date().getFullYear()} Tallyvis. Early-stage product — details subject to
          change.
        </p>
      </Container>
    </footer>
  );
}
