/**
 * Kept as its own tiny, import-free module (rather than living inline in
 * `StepShell.tsx`) specifically so it can be unit-tested directly —
 * `StepShell.tsx` itself pulls in `next/navigation`, `@tallyvis/config`,
 * and `@tallyvis/ui`, none of which this package's lightweight
 * `environment: "node"` vitest setup (see vitest.config.ts) is set up to
 * resolve the "@/..." alias for outside a real Next.js build.
 *
 * Production hardening (2026-10): the embedded estimator's wordmark used
 * to be an internal `Link href="/estimate"` even while embedded, which
 * took a customer from a business's branded, in-progress estimator to the
 * bare `/estimate` welcome screen — generic, unbranded, "prototype
 * experience" copy with no sign a real business was ever involved (see
 * `StepShell.tsx`'s `TallyvisWordmark` for the full writeup). This is the
 * one invariant that fix rests on: the wordmark must never be a link
 * while embedded.
 */
export function isWordmarkNavigable(embedded: boolean): boolean {
  return !embedded;
}
