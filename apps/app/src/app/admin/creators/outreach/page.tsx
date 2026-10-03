import Link from "next/link";
import { getCreatorOutreachMetricsAdmin, listCreatorFollowUpsDueAdmin, listCreatorOutreachQueueAdmin } from "@tallyvis/api";
import { CREATOR_OUTREACH_STATUS_LABELS, type CreatorOutreachStatus } from "@tallyvis/config";
import { buttonVariants } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { EmptyState } from "@/components/dashboard/EmptyState";

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusLabel(status: string): string {
  return CREATOR_OUTREACH_STATUS_LABELS[status as CreatorOutreachStatus] ?? status;
}

function formatFollowers(count: number | undefined): string {
  if (count === undefined) return "—";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export default async function AdminCreatorOutreachPage() {
  const { db, session } = await requireAdminContext();

  const [metrics, queue, followUpsDue] = await Promise.all([
    getCreatorOutreachMetricsAdmin(db, session),
    listCreatorOutreachQueueAdmin(db, session),
    listCreatorFollowUpsDueAdmin(db, session),
  ]);

  const coldQueue = queue.filter((entry) => !entry.followUpDue);
  const notContacted = metrics.totalProspects - metrics.contacted;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/creators" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
            ← Creators
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Creator Outreach</h1>
          <p className="text-ink-soft">Finding, researching, and contacting prospective Founding Creators.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/creators/outreach/metrics" className={buttonVariants({ variant: "outline" })}>
            Metrics
          </Link>
          <Link href="/admin/creators/outreach/import" className={buttonVariants({ variant: "primary" })}>
            Import creator prospects
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <MetricCard label="Prospects" value={String(metrics.totalProspects)} />
        <MetricCard label="Not contacted" value={String(notContacted)} />
        <MetricCard label="Contacted" value={String(metrics.contacted)} />
        <MetricCard label="Awaiting reply" value={String(metrics.awaitingReply)} />
        <MetricCard label="Interested" value={String(metrics.interested)} />
        <MetricCard label="Follow-ups due" value={String(metrics.followUpsDue)} />
        <MetricCard label="Converted" value={String(metrics.converted)} />
      </div>

      {followUpsDue.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Creator follow-ups due ({followUpsDue.length})</h2>
          <div className="flex flex-col gap-3">
            {followUpsDue.map(({ prospect, lastActivity }) => (
              <div key={prospect.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="min-w-0">
                  <Link href={`/admin/creators/outreach/${prospect.id}`} className="font-semibold text-ink hover:underline">
                    {prospect.displayName}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    Last contacted: {formatDateTime(prospect.lastContactedAt)} · {statusLabel(lastActivity.status)}
                  </p>
                  {lastActivity.notes ? <p className="mt-1 text-sm text-ink-faint">{lastActivity.notes}</p> : null}
                </div>
                <Link href={`/admin/creators/outreach/${prospect.id}`} className={buttonVariants({ variant: "primary" })}>
                  Open Creator
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Queue ({coldQueue.length})</h2>
        {coldQueue.length === 0 ? (
          <EmptyState
            heading="No creator prospects in the queue."
            description="Paste a researched list from ChatGPT or a spreadsheet to get started."
            action={
              <Link href="/admin/creators/outreach/import" className={buttonVariants({ variant: "primary" })}>
                Import creator prospects
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-paper-alt text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Creator</th>
                  <th className="px-4 py-3 font-medium">Platform</th>
                  <th className="px-4 py-3 font-medium">Audience</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last contacted</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {coldQueue.map((entry) => (
                  <tr key={entry.prospect.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/admin/creators/outreach/${entry.prospect.id}`} className="hover:underline">
                        {entry.prospect.displayName}
                      </Link>
                      {entry.prospect.niche ? <span className="block text-xs text-ink-faint">{entry.prospect.niche}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{entry.prospect.platform || "—"}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatFollowers(entry.prospect.followersApprox)}</td>
                    <td className="px-4 py-3 text-ink-soft">{entry.prospect.contactEmail ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-ink-soft">{statusLabel(entry.prospect.status)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(entry.prospect.lastContactedAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/creators/outreach/${entry.prospect.id}`}
                        className={buttonVariants({ variant: "outline", className: "px-3 py-1.5 text-xs" })}
                      >
                        Open
                      </Link>
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
