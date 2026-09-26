"use server";

import { headers } from "next/headers";

/**
 * apps/web's contact form. This app has no database and never imports
 * @tallyvis/api (see docs/decisions/0002-app-separation.md) — it isn't a
 * business's own dashboard action, just a marketing-site lead form — so
 * rather than pull in the whole backend package for one email, this calls
 * Resend's HTTP API directly with its own env vars, the same
 * no-SDK-dependency choice services/api/src/notifications/providers/resend.ts
 * already made. See .env.example's "apps/web's /contact form" section for
 * the three required variables.
 */

export interface ContactActionState {
  submitted?: boolean;
  error?: string;
}

const NAME_MAX_LENGTH = 200;
const MESSAGE_MIN_LENGTH = 10;
const MESSAGE_MAX_LENGTH = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOT_CONFIGURED_MESSAGE =
  "The contact form isn't set up yet. Please reach out at hello@tallyvis.com in the meantime.";
const GENERIC_FAILURE_MESSAGE = "Something went wrong sending your message. Please try again in a moment.";

/**
 * Best-effort, single-process per-IP throttle — the same documented
 * limitation as services/api/src/services/passwordReset.ts's cooldown (not
 * a distributed rate limiter, just enough to stop a trivial scripted-spam
 * loop against a public endpoint with no other rate-limiting
 * infrastructure in front of it). Resets on every deploy/cold start.
 */
const SUBMIT_COOLDOWN_MS = 30 * 1000;
const lastSubmitAt = new Map<string, number>();

function isThrottled(key: string): boolean {
  const last = lastSubmitAt.get(key);
  return last !== undefined && Date.now() - last < SUBMIT_COOLDOWN_MS;
}

async function clientKey(): Promise<string> {
  const h = await headers();
  // Vercel sets this; falls back to a shared bucket if it's ever absent
  // (e.g. local dev) rather than throwing.
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

async function sendContactEmail(input: { name: string; email: string; message: string }): Promise<void> {
  const apiKey = process.env.CONTACT_RESEND_API_KEY;
  const fromAddress = process.env.CONTACT_EMAIL_FROM_ADDRESS;
  const toAddress = process.env.CONTACT_EMAIL_TO_ADDRESS;
  if (!apiKey || !fromAddress || !toAddress) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

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
        subject: `Tallyvis contact form: ${input.name}`,
        text: `From: ${input.name} <${input.email}>\n\n${input.message}`,
        html: `<p><strong>From:</strong> ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</p><p>${escapeHtml(input.message).replaceAll("\n", "<br/>")}</p>`,
      }),
    });
  } catch {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
}

export async function submitContactAction(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  // Honeypot: a hidden field real visitors never see or fill in (see the
  // form markup). A bot that fills every field gets a fake success — never
  // told why, so it learns nothing about the trap.
  if (String(formData.get("company") ?? "").trim() !== "") {
    return { submitted: true };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name || name.length > NAME_MAX_LENGTH) {
    return { error: "Please enter your name." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (message.length < MESSAGE_MIN_LENGTH) {
    return { error: "Please include a short message so we know how to help." };
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
    await sendContactEmail({ name, email, message });
  } catch (err) {
    return { error: err instanceof Error ? err.message : GENERIC_FAILURE_MESSAGE };
  }

  return { submitted: true };
}
