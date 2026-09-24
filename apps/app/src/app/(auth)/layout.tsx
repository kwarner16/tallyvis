import type { ReactNode } from "react";
import { MARKETING_URL } from "@/lib/urls";

/**
 * Shared chrome for the public /login, /signup, /forgot-password, and
 * /reset-password pages — no dashboard nav, since nothing here requires a
 * session yet. The brand mark links to the marketing site
 * (`NEXT_PUBLIC_MARKETING_URL`), not this app's own `/` — apps/web and
 * apps/app are deliberately separate Next.js apps/domains (see
 * docs/decisions/0002-app-separation.md), and this app's own `/` redirects
 * logged-in/out users elsewhere in-app rather than acting as a marketing
 * home, so it was previously a dead end for anyone wanting to leave the
 * app back to tallyvis.com.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5 py-8 sm:px-6">
      <a
        href={MARKETING_URL}
        className="mb-8 flex items-center gap-2 self-center text-base font-semibold text-ink"
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
        Tallyvis
      </a>
      {children}
    </div>
  );
}
