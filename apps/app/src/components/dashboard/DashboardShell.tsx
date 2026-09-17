"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { cn, buttonVariants } from "@tallyvis/ui";
import { logOutAction } from "@/lib/authActions";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Quotes", href: "/dashboard/quotes" },
  { label: "Pricing", href: "/dashboard/pricing" },
  { label: "Settings", href: "/dashboard/settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onNavigate}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(pathname, link.href)
              ? "bg-accent-soft text-accent-strong"
              : "text-ink-soft hover:bg-paper-alt hover:text-ink",
          )}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

export function DashboardShell({
  children,
  businessName,
}: {
  children: ReactNode;
  businessName: string;
}) {
  const pathname = usePathname() ?? "/dashboard";
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-paper-alt lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-8 border-r border-line bg-paper px-4 py-6 lg:flex">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-2 text-base font-semibold text-ink"
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Tallyvis
        </Link>
        <nav aria-label="Dashboard" className="flex flex-col gap-1">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-paper-alt px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Business</p>
            <p className="mt-1 text-sm font-medium text-ink">{businessName}</p>
          </div>
          <form action={logOutAction}>
            <button
              type="submit"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-line bg-paper px-4 py-3 lg:hidden">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-base font-semibold text-ink"
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Tallyvis
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-controls="dashboard-mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-5 w-5"
          >
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </header>
      {mobileOpen ? (
        <nav
          id="dashboard-mobile-nav"
          aria-label="Dashboard"
          className="flex flex-col gap-1 border-b border-line bg-paper px-4 py-3 lg:hidden"
        >
          <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          <form action={logOutAction} className="mt-1">
            <button
              type="submit"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
              Log out
            </button>
          </form>
        </nav>
      ) : null}

      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
