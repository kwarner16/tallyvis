/**
 * The shape every Server Action in this app that can fail in an expected,
 * user-recoverable way should return instead of throwing. Next.js 16
 * strips a thrown error's real `message` in a production build before it
 * ever reaches the client — confirmed against this repo's installed
 * Next.js version, not assumed — replacing it with a generic "An error
 * occurred in the Server Components render..." (React error #441) plus an
 * opaque `digest`. This only ever showed up in production (never in
 * `next dev`, which keeps full messages), which is why the public
 * estimator's "Analysis failed" screen, and later the authenticated
 * dashboard's own AI-analysis/quote-email/billing/pricing/settings
 * actions, could render a minified React error instead of their intended
 * safe message once actually deployed. Modeling every expected failure as
 * a returned value — Next's own current guidance for Server Functions —
 * sidesteps this entirely: a `{ ok: false, message }` return is an
 * ordinary value, not a thrown error, so it's never subject to that
 * redaction.
 *
 * Genuinely unexpected/internal failures (a database outage, a programmer
 * error) should still be caught, logged server-side with full detail, and
 * converted to a safe generic message here rather than left to throw and
 * be silently redacted with no server-side record of what happened.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };
