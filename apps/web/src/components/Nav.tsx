"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { ESTIMATOR_URL } from "@/lib/urls";

const NAV_LINKS = [
  { label: "Product", href: "/#see-what-tallyvis-sees" },
  { label: "How It Works", href: "/#from-photo-to-quote" },
  { label: "Industries", href: "/#industries" },
  { label: "Pricing", href: "/#pricing" },
  { label: "About", href: "/about" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink"
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Tallyvis
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <a href={ESTIMATOR_URL} className={buttonVariants({ variant: "primary" })}>
            Try the Estimator
          </a>
        </div>

        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((prev) => !prev)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-6 w-6"
          >
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-paper px-6 pb-6 pt-2 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-base font-medium text-ink-soft transition-colors hover:bg-paper-alt hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <a
            href={ESTIMATOR_URL}
            onClick={() => setOpen(false)}
            className={buttonVariants({ variant: "primary", className: "mt-4 w-full" })}
          >
            Try the Estimator
          </a>
        </div>
      ) : null}
    </header>
  );
}
