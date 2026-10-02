"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { cn, buttonVariants } from "@tallyvis/ui";
import { logOutAction } from "@/lib/authActions";

const NAV_LINKS = [
  { label: "Overview", href: "/admin" },
  { label: "Businesses", href: "/admin/businesses" },
  { label: "Subscriptions", href: "/admin/subscriptions" },
  { label: "Activity", href: "/admin/activity" },
  { label: "Feedback", href: "/admin/feedback" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
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
              ? "bg-paper/10 text-paper"
              : "text-paper/60 hover:bg-paper/5 hover:text-paper/90",
          )}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

/**
 * Visually distinct from `DashboardShell` on purpose — a dark
 * (`charcoal-950`) chrome, reusing the existing theme tokens (see
 * docs/decisions/0035-admin-dashboard.md's "Design" section), so there is
 * never a moment of confusion about whether this is a customer's own
 * workspace or TallyVis's own internal command center. Every `/admin/*`
 * page using this shell has already passed `requireAdminContext()` in its
 * layout before this ever renders.
 */
export function AdminShell({ children, adminEmail }: { children: ReactNode; adminEmail: string }) {
  const pathname = usePathname() ?? "/admin";
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-paper-alt lg:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col gap-8 border-r border-charcoal-line bg-charcoal-950 px-4 py-6 lg:flex">
        <Link href="/admin" className="flex items-center gap-2 px-2 text-base font-semibold text-paper">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          TallyVis Admin
        </Link>
        <nav aria-label="Admin" className="flex flex-col gap-1">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-lg border border-charcoal-line bg-charcoal-900 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-paper/50">Signed in as</p>
            <p className="mt-1 truncate text-sm font-medium text-paper">{adminEmail}</p>
          </div>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline-dark", className: "w-full" })}>
            Back to dashboard
          </Link>
          <form action={logOutAction}>
            <button type="submit" className={buttonVariants({ variant: "outline-dark", className: "w-full" })}>
              Log out
            </button>
          </form>
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-charcoal-line bg-charcoal-950 px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2 text-base font-semibold text-paper">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          TallyVis Admin
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-controls="admin-mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-paper"
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
          id="admin-mobile-nav"
          aria-label="Admin"
          className="flex flex-col gap-1 border-b border-charcoal-line bg-charcoal-950 px-4 py-3 lg:hidden"
        >
          <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline-dark", className: "mt-1 w-full" })}
            onClick={() => setMobileOpen(false)}
          >
            Back to dashboard
          </Link>
          <form action={logOutAction} className="mt-1">
            <button type="submit" className={buttonVariants({ variant: "outline-dark", className: "w-full" })}>
              Log out
            </button>
          </form>
        </nav>
      ) : null}

      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
