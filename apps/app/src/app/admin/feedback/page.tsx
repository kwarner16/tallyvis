import { listFeedbackAdmin, type Feedback } from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";

const TYPE_LABELS: Record<Feedback["type"], string> = {
  bug: "Bug",
  suggestion: "Suggestion",
  feedback: "Feedback",
};

const TYPE_BADGE_CLASS: Record<Feedback["type"], string> = {
  bug: "bg-red-100 text-red-700",
  suggestion: "bg-blue-100 text-blue-700",
  feedback: "bg-amber-100 text-amber-800",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FeedbackRow({ item }: { item: Feedback }) {
  return (
    <details className="group rounded-xl border border-line bg-paper px-4 py-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TYPE_BADGE_CLASS[item.type]}`}>
          {TYPE_LABELS[item.type]}
        </span>
        <span className="font-medium text-ink">{item.businessName}</span>
        <span className="text-ink-faint">{item.userEmail}</span>
        <span className="flex-1 truncate text-ink-soft">{item.message}</span>
        <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(item.createdAt)}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm">
        <p className="whitespace-pre-wrap text-ink">{item.message}</p>
        <dl className="flex flex-wrap gap-4 text-xs text-ink-faint">
          {item.sourcePath ? (
            <div>
              <dt className="inline font-medium">Page: </dt>
              <dd className="inline">{item.sourcePath}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-medium">Contact requested: </dt>
            <dd className="inline">{item.contactMe ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

export default async function AdminFeedbackPage() {
  const { db, session } = await requireAdminContext();
  const feedback = await listFeedbackAdmin(db, session);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Feedback</h1>
        <p className="text-ink-soft">
          {feedback.length} submission{feedback.length === 1 ? "" : "s"} from businesses. Tap a row for the full
          message.
        </p>
      </div>

      {feedback.length === 0 ? (
        <p className="text-sm text-ink-soft">No feedback submitted yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {feedback.map((item) => (
            <FeedbackRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
