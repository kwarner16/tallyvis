/**
 * The shape every unauthenticated public Server Action in `publicActions.ts`
 * returns instead of throwing. Next.js 16 strips a thrown error's real
 * `message` in a production build before it ever reaches the client —
 * confirmed against this repo's installed Next.js version, not assumed —
 * replacing it with a generic "An error occurred in the Server Components
 * render..." (React error #441) plus an opaque `digest`. This only ever
 * showed up in production (never in `next dev`, which keeps full messages),
 * which is exactly why the public estimator's "Analysis failed" screen
 * rendered a minified React error instead of its intended safe message once
 * actually deployed. Modeling every expected failure as a returned value —
 * Next's own current guidance for Server Functions — sidesteps this
 * entirely: a `{ ok: false, message }` return is an ordinary value, not a
 * thrown error, so it's never subject to that redaction.
 */
export type PublicActionResult<T> = { ok: true; data: T } | { ok: false; message: string };
