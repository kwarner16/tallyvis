# 0038 — Customer quote photo storage (production hardening)

## Status

Accepted. Implemented as part of the pre-launch production hardening pass
(2026-10), alongside the embed-logo, admin-signup-notification, and
business-feedback fixes from the same pass.

## Context

A manual-testing pass found that customer-submitted photos never actually
appeared on the business dashboard's quote detail page, even though the
page already had a "Photos" section built for them. Tracing the full
lifecycle (customer upload → client state → "storage" → AI analysis →
quote creation → dashboard retrieval → rendering) found the root cause:
photos were **never persisted anywhere**. `EstimatorContext.addPhotos`
compresses each photo client-side and keeps it only as a browser `blob:`
object URL (`URL.createObjectURL`) — valid only inside the tab that
created it, for the lifetime of that tab. `/estimate/result` took that
same `blob:` string and wrote it straight into the `Quote.photos[].url`
field that got persisted to Postgres. The dashboard's "Photos" grid then
rendered `<img src={photo.url}>` with that same now-meaningless string —
broken in literally every context except the original customer's own
browser tab, moments after upload. There was no object storage of any
kind in this repository before this change (no `@vercel/blob`, no S3, no
equivalent) — this was a real gap, not a misconfiguration.

AI analysis (`analyzePublicPropertyAction`) already solved the "a
`blob:` URL is meaningless off-tab" problem for its own, narrower need:
`imageEncoding.ts`'s `blobUrlToDataUrl` reads the blob back into a base64
`data:` URI client-side, on demand, right before the one request that
needs the bytes. That request is one-shot and stateless on the server
side — nothing is kept after the AI call returns. Quote creation needed
the same bytes-crossing-the-boundary step, but durably.

## Decision

1. **Storage**: a private Vercel Blob store (`tallyvis-quote-photos`,
   `access: "private"`), provisioned via the Vercel CLI
   (`vercel blob create-store ... --access private`) and linked to the
   `tallyvis-app` Vercel project, which auto-provisioned
   `BLOB_READ_WRITE_TOKEN` across Production/Preview/Development. Chosen
   over standing up S3/GCS/a third vendor because the app is already a
   Vercel project with no existing object-storage account to reuse —
   Blob is the zero-new-vendor, zero-new-account option, and "private"
   access means a pathname is never independently fetchable; every read
   requires the same server-side token this app already controls. This
   is a genuinely new piece of infrastructure, called out explicitly per
   CLAUDE.md's mock/stub-labeling convention: it is real, not a stub, and
   it is the one new paid dependency this pass introduces.
2. **Upload path**: `/estimate/result` converts each photo's `blob:` URL
   to a base64 `data:` URI (`blobUrlToDataUrl`, already existed for AI
   analysis) and sends it to `createPublicQuoteAction`/
   `updatePublicQuoteAction` as `{ id, dataUrl }` — never a `url` field
   again. `services/api`'s `persistPricedQuote` (shared by both
   `createQuote` and `createQuotePublic`) decodes and uploads each photo
   via the new `storage/` package before the quote row is ever written,
   and stores the resulting opaque `storageKey` (NOT a URL) on
   `Quote.photos[]`. A photo that fails to decode/upload is skipped, not
   fatal — the customer's price and request must still reach the
   business even if one photo can't be stored, the same "secondary
   concern never blocks the primary flow" principle `services/api`
   already applies to SMS/email sends. The same is true if photo storage
   isn't configured in an environment at all (no `BLOB_READ_WRITE_TOKEN`):
   the quote still saves, just with no photos, logged once server-side.
3. **Read path**: a new authenticated Next.js Route Handler,
   `apps/app/src/app/api/quotes/[id]/photos/[photoId]/route.ts`. It
   resolves the caller's session, then calls `getQuotePhoto`, which loads
   the quote through the existing `WHERE business_id = $2`-scoped
   `getQuoteById` — so a wrong/guessed id for another business's quote or
   photo resolves to the same 404 as a quote that doesn't exist, never
   that business's photo. The dashboard's `<img>` tags point at this
   route (`/api/quotes/{id}/photos/{photoId}`), never at `storageKey`
   directly — `storageKey` is meaningless to a browser and never leaves
   the server. No public route (the `/quote/[token]` share-token page,
   the public estimator itself) exposes photos — that remains a
   deliberate non-goal of this pass, not an oversight; CLAUDE.md's
   default is "customer property photos are private," and nothing here
   required changing that.
4. **Re-analysis gap closed in passing**: `updateQuotePublic` (the path
   a customer hits by going back to add another photo before finishing)
   previously updated the quote's analysis/estimate but never touched
   `photos` at all — a second, closely related way photos could go
   missing even once the primary bug above was fixed. It now re-uploads
   and persists the customer's current full photo set on every
   re-analysis. A photo already uploaded on an earlier submission is
   uploaded again under a fresh key on resubmission (the original becomes
   an orphaned blob); accepted as a minor, bounded storage cost rather
   than building reconciliation logic for what is already a deliberate
   minority path. A future cleanup job could sweep orphaned keys; not
   built here (not needed for launch).

## Consequences

- `packages/types`' `QuotePhoto.url: string` became
  `QuotePhoto.storageKey: string`, with a doc comment making the "never
  render this directly" invariant explicit. Low blast radius: every
  non-empty use of this field was the two places this ADR fixes; every
  test fixture already used `photos: []`.
- `services/api` gained one new dependency, `@vercel/blob`, and one new
  environment variable, `BLOB_READ_WRITE_TOKEN` (documented in
  `.env.example`).
- The dashboard's "New quote" flow (`NewQuoteClient`, authenticated,
  business-entered) still never attaches photos to the quote it creates
  (`photos: []`, unchanged) — it only ever used photos as a transient AI
  analysis aid, discarded after. Attaching business-side photos to a
  manually created quote is a plausible future improvement, not part of
  this fix.
- What was and wasn't verified against the real Blob store: a private
  store was created and linked via the Vercel CLI, and `BLOB_READ_WRITE_TOKEN`
  was confirmed present across Production/Preview/Development. The
  upload/download round trip itself is covered by this pass's automated
  tests against the `PhotoStorage` interface with an injected in-memory
  fake (consistent with how `EmailProvider`/`SmsProvider` are tested) —
  not a live call to Vercel's API from this environment. A real end-to-end
  photo submission through the deployed app is part of Kyle's own
  acceptance testing after this lands.
