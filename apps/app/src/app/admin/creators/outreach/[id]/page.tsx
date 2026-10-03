import Link from "next/link";
import { notFound } from "next/navigation";
import { getCreatorProspectDetailAdmin } from "@tallyvis/api";
import { CREATOR_OUTREACH_STATUS_LABELS, type CreatorOutreachStatus } from "@tallyvis/config";
import { requireAdminContext } from "@/lib/adminSession";
import { EditCreatorProspectForm } from "@/components/admin/creatorOutreach/EditCreatorProspectForm";
import { CopyEmailButton } from "@/components/admin/creatorOutreach/CopyEmailButton";
import { RecordOutreachActivityForm } from "@/components/admin/creatorOutreach/RecordOutreachActivityForm";
import { ConvertToCreatorForm } from "@/components/admin/creatorOutreach/ConvertToCreatorForm";

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

export default async function AdminCreatorOutreachProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, session } = await requireAdminContext();
  const { id } = await params;
  const detail = await getCreatorProspectDetailAdmin(db, session, id);
  if (!detail) notFound();

  const { prospect, activities } = detail;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/creators/outreach" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Creator Outreach
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{prospect.displayName}</h1>
        <p className="text-ink-soft">
          {statusLabel(prospect.status)}
          {prospect.niche ? ` · ${prospect.niche}` : ""}
          {prospect.followersApprox !== undefined ? ` · ~${formatFollowers(prospect.followersApprox)} followers` : ""}
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Profile</h2>
        <div className="flex flex-wrap items-center gap-3">
          {prospect.profileUrl ? (
            <a
              href={prospect.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line bg-paper-alt px-4 py-2 text-sm font-medium text-ink hover:border-ink"
            >
              View {prospect.platform || "Profile"} →
            </a>
          ) : (
            <p className="text-sm text-ink-soft">No profile URL on file.</p>
          )}
          {prospect.contactEmail ? (
            <a
              href={`mailto:${prospect.contactEmail}?subject=${encodeURIComponent("A partnership idea for you")}`}
              className="rounded-lg border border-line bg-paper-alt px-4 py-2 text-sm font-medium text-ink hover:border-ink"
            >
              Email {prospect.contactEmail}
            </a>
          ) : (
            <p className="text-sm text-ink-soft">No contact email on file.</p>
          )}
        </div>
        {prospect.otherProfileUrls.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {prospect.otherProfileUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-accent-strong hover:underline"
              >
                {url}
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Contact information</h2>
        <EditCreatorProspectForm prospect={prospect} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Outreach emails</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <CopyEmailButton label="Copy Email #1" template="email1" contactName={prospect.contactName} />
          <CopyEmailButton label="Copy Email #2" template="email2" contactName={prospect.contactName} />
        </div>
        <p className="text-xs text-ink-faint">
          TallyVis never sends these — copy, paste into your own email client, personalize, and send manually.
        </p>
      </section>

      {prospect.status !== "converted" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Record outreach activity</h2>
          <RecordOutreachActivityForm prospectId={prospect.id} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Outreach history ({activities.length})</h2>
        {activities.length === 0 ? (
          <p className="text-sm text-ink-soft">No activity recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {activities.map((activity) => (
              <div key={activity.id} className="rounded-2xl border border-line bg-paper p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{formatDateTime(activity.createdAt)}</p>
                  <span className="rounded-full bg-paper-alt px-2 py-0.5 text-xs font-semibold text-ink-soft">
                    {statusLabel(activity.status)}
                  </span>
                </div>
                {activity.notes ? <p className="mt-2 text-sm text-ink-soft">{activity.notes}</p> : null}
                {activity.followUpAt ? (
                  <p className="mt-2 text-xs text-ink-faint">Follow-up scheduled: {formatDateTime(activity.followUpAt)}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Founding Creator Program</h2>
        {prospect.convertedCreatorId ? (
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-green-700">Converted to a Founding Creator.</p>
            <Link href={`/admin/creators/${prospect.convertedCreatorId}`} className="text-sm font-medium text-accent-strong hover:underline">
              View creator →
            </Link>
          </div>
        ) : (
          <ConvertToCreatorForm prospect={prospect} />
        )}
      </section>
    </div>
  );
}
