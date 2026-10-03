import Link from "next/link";
import {
  getActiveSalesCallAdmin,
  getTodaySalesSummaryAdmin,
  listFollowUpsDueAdmin,
  listProspectQueueAdmin,
} from "@tallyvis/api";
import { SALES_CALL_OUTCOME_LABELS, type SalesCallOutcome } from "@tallyvis/config";
import { buttonVariants } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StartCallButton } from "@/components/admin/sales/StartCallButton";

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function outcomeLabel(outcome: string | undefined): string {
  if (!outcome) return "Not yet contacted";
  return SALES_CALL_OUTCOME_LABELS[outcome as SalesCallOutcome] ?? outcome;
}

export default async function AdminSalesPage() {
  const { db, session } = await requireAdminContext();

  const [summary, queue, followUpsDue, activeCall] = await Promise.all([
    getTodaySalesSummaryAdmin(db, session),
    listProspectQueueAdmin(db, session),
    listFollowUpsDueAdmin(db, session),
    getActiveSalesCallAdmin(db, session),
  ]);

  const coldQueue = queue.filter((entry) => !entry.followUpDue);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Sales</h1>
          <p className="text-ink-soft">Cold-calling queue and call tracking.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/sales/metrics" className={buttonVariants({ variant: "outline" })}>
            Metrics
          </Link>
          <Link href="/admin/sales/import" className={buttonVariants({ variant: "primary" })}>
            Import prospects
          </Link>
        </div>
      </div>

      {activeCall ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent bg-accent-soft p-5">
          <div>
            <p className="text-sm font-semibold text-accent-strong">You have an active call in progress</p>
            <p className="text-sm text-ink-soft">Started {formatDateTime(activeCall.startedAt)}.</p>
          </div>
          <Link href={`/admin/sales/call/${activeCall.id}`} className={buttonVariants({ variant: "primary" })}>
            Resume call
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <MetricCard label="Calls today" value={String(summary.callsToday)} />
        <MetricCard label="Answered" value={String(summary.answeredToday)} />
        <MetricCard label="Interested" value={String(summary.interestedToday)} />
        <MetricCard label="Follow-ups due" value={String(summary.followUpsDueCount)} />
        <MetricCard label="Signed up" value={String(summary.signedUpToday)} />
      </div>

      {followUpsDue.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Follow-ups due ({followUpsDue.length})</h2>
          <div className="flex flex-col gap-3">
            {followUpsDue.map(({ prospect, lastCall }) => (
              <div key={prospect.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="min-w-0">
                  <Link href={`/admin/sales/${prospect.id}`} className="font-semibold text-ink hover:underline">
                    {prospect.businessName}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    Last contacted: {formatDateTime(lastCall.startedAt)} · {outcomeLabel(lastCall.outcome)}
                  </p>
                  {lastCall.notes ? <p className="mt-1 text-sm text-ink-faint">{lastCall.notes}</p> : null}
                </div>
                <StartCallButton prospectId={prospect.id} label="Start Follow-Up Call" disabled={Boolean(activeCall)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Queue ({coldQueue.length})</h2>
        {coldQueue.length === 0 ? (
          <EmptyState
            heading="No prospects in the queue."
            description="Paste a list from ChatGPT or a spreadsheet to get started."
            action={
              <Link href="/admin/sales/import" className={buttonVariants({ variant: "primary" })}>
                Import prospects
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last contacted</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {coldQueue.map((entry) => (
                  <tr key={entry.prospect.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/admin/sales/${entry.prospect.id}`} className="hover:underline">
                        {entry.prospect.businessName}
                      </Link>
                      {entry.prospect.contactName ? (
                        <span className="block text-xs text-ink-faint">{entry.prospect.contactName}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {[entry.prospect.city, entry.prospect.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">{entry.prospect.phone}</td>
                    <td className="px-4 py-3 text-ink-soft">{outcomeLabel(entry.lastOutcome)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(entry.lastCallAt)}</td>
                    <td className="px-4 py-3">
                      <StartCallButton prospectId={entry.prospect.id} label="Start Call" disabled={Boolean(activeCall)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
