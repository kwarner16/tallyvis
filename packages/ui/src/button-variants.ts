import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "outline-dark" | "destructive";

export interface ButtonVariantOptions {
  variant?: ButtonVariant;
  className?: string;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent-strong text-accent-foreground hover:bg-accent-strong-hover",
  secondary: "bg-ink text-paper hover:bg-charcoal-900",
  outline: "border border-line bg-transparent text-ink hover:border-ink",
  "outline-dark": "border border-charcoal-line bg-transparent text-paper hover:border-paper/60",
  /** For irreversible/destructive actions (e.g. account deletion) — deliberately distinct from "primary" so a business owner never confuses the two at a glance. */
  destructive: "bg-red-600 text-paper hover:bg-red-700",
};

/**
 * Returns Tallyvis button styling as a class string, so it can be applied to
 * a real <button> (via <Button>) or to a Next.js <Link>/<a> used as a CTA.
 */
export function buttonVariants({ variant = "primary", className }: ButtonVariantOptions = {}) {
  return cn(base, variants[variant], className);
}
