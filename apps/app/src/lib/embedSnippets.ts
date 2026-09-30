/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — pure snippet builders, factored out of `WebsiteInstallClient.tsx` so
 * they're covered by a plain unit test (`__tests__/embedSnippets.test.ts`)
 * without needing to render the component. Both snippets only ever carry
 * the business's own PUBLIC embed id — never its internal `businessId` —
 * and resolve entirely through the existing `/embed/[embedId]` route (see
 * `services/api`'s `resolveEmbedBusiness`), so there is no separate
 * security surface to reason about between the two installation methods.
 */

/** The existing script-tag install method — unchanged, still the preferred option wherever a platform allows it. */
export function buildScriptSnippet(appOrigin: string, publicEmbedId: string): string {
  return `<div id="tallyvis-estimator"></div>\n<script src="${appOrigin}/embed.js" data-tallyvis-id="${publicEmbedId}"></script>`;
}

/**
 * The raw-iframe fallback for platforms/builders that restrict or strip
 * `<script>` tags (a common GoDaddy Website Builder limitation, some
 * WordPress.com plans, some Shopify theme sections). Points at the exact
 * same `/embed/[embedId]` route `embed.js` itself uses internally — this is
 * not a new or less-isolated mechanism, just the same one made directly
 * copy-pasteable.
 */
export function buildIframeSnippet(appOrigin: string, publicEmbedId: string): string {
  return `<iframe src="${appOrigin}/embed/${publicEmbedId}" title="Tallyvis estimator" width="100%" height="640" style="border:0" loading="lazy"></iframe>`;
}
