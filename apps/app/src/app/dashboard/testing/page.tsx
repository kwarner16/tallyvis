import { computeBenchmarkMetrics, listBenchmarkCases } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { BenchmarkTestingClient } from "@/components/dashboard/BenchmarkTestingClient";

/**
 * Final validation & launch-readiness phase (2026-09) — internal estimator
 * benchmark harness. Authenticated and tenant-scoped like every other
 * /dashboard/* route (see dashboard/layout.tsx's `requireContext()` call,
 * which already gates this whole route tree) — for Tallyvis's own
 * internal/business-owner testing against known ground truth, never
 * customer-facing.
 */
export default async function BenchmarkTestingPage() {
  const { db, session } = await requireContext();
  const cases = await listBenchmarkCases(db, session);
  const metrics = computeBenchmarkMetrics(cases);

  return <BenchmarkTestingClient initialCases={cases} initialMetrics={metrics} />;
}
