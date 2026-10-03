import { buttonVariants } from "@tallyvis/ui";
import { startCallAction } from "@/lib/salesAdminActions";

/**
 * Plain server-rendered form, no client JS needed — `startCallAction`
 * resumes an already-active call instead of creating a second one, but
 * the button is disabled here whenever one is already in progress so
 * clicking "Start Call" on a DIFFERENT prospect never silently redirects
 * to someone else's in-progress call (see the ADR's "Call lifecycle"
 * section).
 */
export function StartCallButton({ prospectId, label, disabled }: { prospectId: string; label: string; disabled?: boolean }) {
  return (
    <form action={startCallAction}>
      <input type="hidden" name="prospectId" value={prospectId} />
      <button
        type="submit"
        disabled={disabled}
        className={buttonVariants({ variant: "primary", className: "px-3 py-1.5 text-xs disabled:cursor-not-allowed" })}
      >
        {label}
      </button>
    </form>
  );
}
