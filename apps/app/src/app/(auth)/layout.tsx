import Link from "next/link";
import type { ReactNode } from "react";

/** Shared chrome for the public /login and /signup pages — no dashboard nav, since nothing here requires a session yet. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5 py-8 sm:px-6">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 self-center text-base font-semibold text-ink"
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
        Tallyvis
      </Link>
      {children}
    </div>
  );
}
