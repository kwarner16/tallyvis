/**
 * Shared by every notification that interpolates user-supplied text (a
 * business/customer name, an email address) into an HTML email body —
 * without this, a name containing `<`/`>` would be injected verbatim into
 * HTML an email client renders. Previously duplicated inline in
 * `quoteEmail.ts`; factored out once a second caller (`adminNotifications.ts`)
 * needed the exact same thing.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
