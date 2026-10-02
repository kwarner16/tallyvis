"use server";

import { headers } from "next/headers";

/**
 * TallyVis Founding Creator Program — the public `/creators` page's
 * "apply to join" mechanism (see
 * docs/decisions/0040-creator-affiliate-program.md). Deliberately reuses
 * the EXACT same email infrastructure/env vars as `contactActions.ts`'s
 * contact form (same Resend HTTP call, same destination) rather than
 * introducing a second form-handling dependency — the only thing that
 * actually differs from a plain contact message is the subject line and
 * the extra platform/profile-URL fields, so Kyle can tell an application
 * apart from a general inquiry in his inbox. No `creators` database row
 * is created from this form — see that ADR's "Creator landing page"
 * section for why the application stays a lead (an email Kyle reviews),
 * with the real `creators` row only ever created deliberately, by Kyle,
 * through the admin UI once he's decided to bring someone on.
 */

export interface CreatorApplicationState {
  submitted?: boolean;
  error?: string;
}

const NAME_MAX_LENGTH = 200;
const URL_MAX_LENGTH = 500;
const MESSAGE_MAX_LENGTH = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOT_CONFIGURED_MESSAGE =
  "Applications aren't set up yet. Please reach out at hello@tallyvis.com in the meantime.";
const GENERIC_FAILURE_MESSAGE = "Something went wrong sending your application. Please try again in a moment.";

/** Same documented single-process-only limitation as `contactActions.ts`'s identical throttle. */
const SUBMIT_COOLDOWN_MS = 30 * 1000;
const lastSubmitAt = new Map<string, number>();

function isThrottled(key: string): boolean {
  const last = lastSubmitAt.get(key);
  return last !== undefined && Date.now() - last < SUBMIT_COOLDOWN_MS;
}

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendApplicationEmail(input: { name: string; email: string; platform: string; profileUrl: string; message: string }): Promise<void> {
  const apiKey = process.env.CONTACT_RESEND_API_KEY;
  const fromAddress = process.env.CONTACT_EMAIL_FROM_ADDRESS;
  const toAddress = process.env.CONTACT_EMAIL_TO_ADDRESS;
  if (!apiKey || !fromAddress || !toAddress) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  const lines = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Platform: ${input.platform || "(not provided)"}`,
    `Profile/channel URL: ${input.profileUrl || "(not provided)"}`,
    "",
    input.message || "(no message)",
  ];

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        reply_to: input.email,
        subject: `TallyVis Creator Program application: ${input.name}`,
        text: lines.join("\n"),
        html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
      }),
    });
  } catch {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
}

export async function submitCreatorApplicationAction(
  _prevState: CreatorApplicationState,
  formData: FormData,
): Promise<CreatorApplicationState> {
  // Honeypot — same pattern as contactActions.ts's identical field.
  if (String(formData.get("company") ?? "").trim() !== "") {
    return { submitted: true };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();
  const profileUrl = String(formData.get("profileUrl") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name || name.length > NAME_MAX_LENGTH) {
    return { error: "Please enter your name." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (profileUrl.length > URL_MAX_LENGTH) {
    return { error: "That profile URL is too long." };
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return { error: `Message is too long (max ${MESSAGE_MAX_LENGTH} characters).` };
  }

  const key = await clientKey();
  if (isThrottled(key)) {
    return { error: "You're submitting a bit fast — please wait a moment and try again." };
  }
  lastSubmitAt.set(key, Date.now());

  try {
    await sendApplicationEmail({ name, email, platform, profileUrl, message });
  } catch (err) {
    return { error: err instanceof Error ? err.message : GENERIC_FAILURE_MESSAGE };
  }

  return { submitted: true };
}
