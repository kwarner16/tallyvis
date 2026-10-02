import Link from "next/link";
import type { AdminRecentEventRow } from "@tallyvis/api";

const KIND_LABELS: Record<AdminRecentEventRow["kind"], string> = {
  business_signed_up: "signed up",
  subscription_started: "started a subscription",
  subscription_canceled: "canceled their subscription",
  quote_created: "created a quote",
  quote_accepted: "had a quote accepted",
  quote_declined: "had a quote declined",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Renders the events `listRecentActivityEvents`/`getAdminOverview` derive from existing timestamp columns — see services/admin.ts's own comment on why this isn't backed by a dedicated event table yet. */
export function RecentActivityFeed({ events }: { events: AdminRecentEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-soft">No activity yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {events.map((event, index) => (
        <li key={`${event.kind}-${event.businessId}-${event.occurredAt}-${index}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <p className="text-ink-soft">
            <Link href={`/admin/businesses/${event.businessId}`} className="font-medium text-ink hover:underline">
              {event.businessName}
            </Link>{" "}
            {KIND_LABELS[event.kind]}
            {event.detail ? <span className="text-ink-faint"> ({event.detail})</span> : null}
          </p>
          <p className="shrink-0 text-xs text-ink-faint">{formatTimestamp(event.occurredAt)}</p>
        </li>
      ))}
    </ul>
  );
}
