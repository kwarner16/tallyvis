import type { Business } from "@tallyvis/types";
import { sendEmail } from "../notifications";
import { sendSms } from "../notifications/sms";
import { escapeHtml } from "../notifications/htmlEscape";
import type { Feedback } from "../repositories/feedback";

/**
 * Production hardening (see docs/decisions/0039-embed-logo-signup-
 * notifications-and-feedback.md) — internal TallyVis admin notifications.
 * Deliberately a SEPARATE concern from every customer-facing or
 * business-owner-facing notification already in this package:
 *
 *   - NOT the business owner's own new-quote SMS alert
 *     (`quoteSmsAlert.ts`) — that goes to the BUSINESS's configured
 *     notification number, gated on that business's own
 *     `smsNotificationsEnabled`/`notificationPhone` settings.
 *   - NOT a customer-facing message (`customerSms.ts`) — never gated on,
 *     or even aware of, any customer's SMS consent, because no customer
 *     is involved at all.
 *
 * Both functions here go to Kyle's own TallyVis-internal destinations
 * (`ADMIN_NOTIFICATION_EMAIL`/`ADMIN_NOTIFICATION_PHONE`), read directly
 * from the environment — there is no per-business configuration for
 * these, unlike `quoteSmsAlert.ts`. Every send is fire-and-forget
 * (mirrors `sendNewQuoteSmsAlert`'s `{ finished }` pattern exactly):
 * failure to notify Kyle must never fail account creation or a feedback
 * submission, so every error is caught and logged here, never rethrown.
 */

export type SignupMethod = "password" | "google";

function resolveAdminEmail(): string | null {
  return process.env.ADMIN_NOTIFICATION_EMAIL?.trim() || null;
}

/**
 * A second, explicit opt-in on top of just setting a phone number —
 * mirrors `SMS_A2P_APPROVED`'s "credentials being present doesn't mean
 * sending is wanted yet" precedent in `notifications/sms/index.ts`. Kyle
 * may want the admin phone number configured (e.g. for later use) without
 * every signup immediately texting it.
 */
function resolveAdminSmsPhone(): string | null {
  if (process.env.ADMIN_SIGNUP_SMS_ENABLED?.trim() !== "true") return null;
  return process.env.ADMIN_NOTIFICATION_PHONE?.trim() || null;
}

function swallow(label: string): (err: unknown) => void {
  return (err: unknown) => {
    console.error(`[adminNotifications] ${label} failed:`, err instanceof Error ? err.message : "unknown error");
  };
}

/**
 * Fired exactly once per real new TallyVis business — see `signUp`'s and
 * `createAccountFromGoogle`'s own comments for why each calls this only
 * once, only after its own transaction has actually committed (never from
 * inside the transaction itself, and never on a path that throws/rolls
 * back) and only on an actual `kind: "signup"` outcome, never "login" or
 * "linked". `buildAdminBusinessUrl` is optional and supplied by the
 * caller (apps/app, which owns `APP_URL`) — same injected-URL-builder
 * pattern `sendNewQuoteSmsAlert`'s `buildQuoteUrl` already establishes.
 *
 * Never invents plan/trial status or an owner name: neither is known at
 * this lifecycle point (plan selection happens later in onboarding; no
 * name field is collected at signup at all), so the message says so
 * explicitly rather than guessing.
 */
export function notifyAdminOfNewSignup(
  business: Business,
  method: SignupMethod,
  buildAdminBusinessUrl?: (businessId: string) => string,
): { finished: Promise<void> } {
  const adminLink = buildAdminBusinessUrl?.(business.id);
  const methodLabel = method === "google" ? "Google" : "Email/password";

  const tasks: Promise<void>[] = [];

  const adminEmail = resolveAdminEmail();
  if (adminEmail) {
    const lines = [
      `Business: ${business.name}`,
      `Owner email: ${business.email}`,
      `Signup method: ${methodLabel}`,
      `Created: ${business.createdAt}`,
      "Plan/trial: not yet selected",
    ];
    if (adminLink) lines.push(`Admin view: ${adminLink}`);

    tasks.push(
      sendEmail(
        {
          to: adminEmail,
          subject: `New TallyVis signup — ${business.name}`,
          text: lines.join("\n"),
          html:
            `<p>${lines.map(escapeHtml).join("</p>\n<p>")}</p>` +
            (adminLink ? `<p><a href="${adminLink}">Open in admin dashboard</a></p>` : ""),
        },
        "admin-new-signup",
      )
        .then(() => {})
        .catch(swallow("new-signup email")),
    );
  } else {
    console.warn("[adminNotifications] ADMIN_NOTIFICATION_EMAIL is not set — skipping the new-signup admin email.");
  }

  const adminPhone = resolveAdminSmsPhone();
  if (adminPhone) {
    const smsLines = [`New TallyVis signup — ${business.name}`, business.email];
    if (adminLink) smsLines.push(`View: ${adminLink}`);

    tasks.push(
      sendSms({ to: adminPhone, body: smsLines.join("\n") }, "admin-new-signup")
        .then(() => {})
        .catch(swallow("new-signup SMS")),
    );
  }

  return { finished: Promise.all(tasks).then(() => {}) };
}

const FEEDBACK_TYPE_LABELS: Record<Feedback["type"], string> = {
  bug: "Bug",
  suggestion: "Suggestion",
  feedback: "Feedback",
};

/**
 * Fired once per persisted feedback row (`submitFeedback` always
 * persists first — see that function's own comment — so a failure here
 * never loses the submission; it's still readable in the admin
 * dashboard's Feedback list either way). Email-only: unlike a new signup,
 * feedback has no dedicated SMS path — `ADMIN_SIGNUP_SMS_ENABLED` is
 * deliberately scoped to signups only, by its own name.
 *
 * `process.env.VERCEL_GIT_COMMIT_SHA` — Vercel's own build-time env var,
 * not something this app sets — is included when present, giving Kyle
 * the exact deployed commit a bug was reported against, without
 * inventing a version string of our own.
 */
export function notifyAdminOfFeedback(feedback: Feedback): { finished: Promise<void> } {
  const adminEmail = resolveAdminEmail();
  if (!adminEmail) {
    console.warn("[adminNotifications] ADMIN_NOTIFICATION_EMAIL is not set — skipping the feedback admin email.");
    return { finished: Promise.resolve() };
  }

  const typeLabel = FEEDBACK_TYPE_LABELS[feedback.type];
  const deployedCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim();

  const lines = [
    `Type: ${typeLabel}`,
    `Business: ${feedback.businessName}`,
    `User: ${feedback.userEmail}`,
    feedback.sourcePath ? `Page: ${feedback.sourcePath}` : null,
    `Contact requested: ${feedback.contactMe ? "Yes" : "No"}`,
    deployedCommit ? `Deployed commit: ${deployedCommit.slice(0, 7)}` : null,
    "",
    feedback.message,
  ].filter((line): line is string => line !== null);

  const finished = sendEmail(
    {
      to: adminEmail,
      subject: `[TallyVis Feedback] ${typeLabel} — ${feedback.businessName}`,
      text: lines.join("\n"),
      html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
    },
    "admin-feedback",
  )
    .then(() => {})
    .catch(swallow("feedback email"));

  return { finished };
}
