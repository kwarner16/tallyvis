/**
 * The positive counterpart to the dashboard's trial/subscription
 * warning banners — shown instead of (never alongside) a "trial has
 * ended"/"reactivate" message whenever `hasComplimentaryAccess` is true
 * for the current business (see
 * docs/decisions/0040-creator-affiliate-program.md's "Free creator
 * access" section). This is a display-only status, not a Stripe
 * subscription — it never claims the underlying subscription/trial is
 * anything other than whatever it actually is; it only communicates
 * that TallyVis product access does not depend on it right now.
 *
 * `compact`: a plain, borderless line for nesting inside a page's own
 * already-bordered card (e.g. Settings' "Billing" card); the default
 * renders as its own standalone card, matching the visual shape of the
 * dashboard's existing trial/expired banners (`rounded-2xl border ...
 * p-5`), just with the same green treatment this codebase already uses
 * elsewhere for a positive creator-program state (e.g. the admin
 * creator detail page's "This business currently has free TallyVis
 * access.").
 */
export function FoundingCreatorAccessNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-sm font-medium text-green-700">
        Founding Creator Access — your TallyVis access is complimentary while you&rsquo;re an active Founding Creator.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-green-200 bg-green-50 p-5">
      <div>
        <p className="text-sm font-semibold text-green-700">Founding Creator Access</p>
        <p className="text-sm text-green-700/80">
          Your TallyVis access is complimentary while you&rsquo;re an active Founding Creator.
        </p>
      </div>
    </div>
  );
}
