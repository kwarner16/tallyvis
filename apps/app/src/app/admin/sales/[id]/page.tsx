import Link from "next/link";
import { notFound } from "next/navigation";
import { getSalesProspectDetailAdmin } from "@tallyvis/api";
import { SALES_CALL_OUTCOME_LABELS, SALES_OBJECTION_LABELS, type SalesCallOutcome, type SalesObjection } from "@tallyvis/config";
import { requireAdminContext } from "@/lib/adminSession";
import { StartCallButton } from "@/components/admin/sales/StartCallButton";
import { EditProspectForm } from "@/components/admin/sales/EditProspectForm";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export default async function AdminSalesProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, session } = await requireAdminContext();
  const { id } = await params;
  const detail = await getSalesProspectDetailAdmin(db, session, id);
  if (!detail) notFound();

  const { prospect, calls } = detail;
  const completedCalls = calls.filter((call) => call.endedAt);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/sales" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
            ← Sales
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{prospect.businessName}</h1>
        </div>
        <StartCallButton prospectId={prospect.id} label="Start Call" />
      </div>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Contact information</h2>
        <EditProspectForm prospect={prospect} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Call history ({completedCalls.length})</h2>
        {completedCalls.length === 0 ? (
          <p className="text-sm text-ink-soft">No calls logged yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {completedCalls.map((call) => (
              <div key={call.id} className="rounded-2xl border border-line bg-paper p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {formatDateTime(call.startedAt)} · {formatDuration(call.durationSeconds)}
                  </p>
                  <span className="rounded-full bg-paper-alt px-2 py-0.5 text-xs font-semibold text-ink-soft">
                    {call.outcome ? SALES_CALL_OUTCOME_LABELS[call.outcome as SalesCallOutcome] ?? call.outcome : "—"}
                  </span>
                </div>
                {call.objections.length > 0 ? (
                  <p className="mt-2 text-sm text-ink-soft">
                    Objection{call.objections.length > 1 ? "s" : ""}:{" "}
                    {call.objections.map((objection) => SALES_OBJECTION_LABELS[objection as SalesObjection] ?? objection).join(", ")}
                  </p>
                ) : null}
                {call.notes ? <p className="mt-2 text-sm text-ink-soft">{call.notes}</p> : null}
                {call.followUpAt ? (
                  <p className="mt-2 text-xs text-ink-faint">Follow-up scheduled: {formatDateTime(call.followUpAt)}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
