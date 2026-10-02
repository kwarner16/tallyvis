import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import * as feedbackRepo from "../repositories/feedback";
import type { Feedback, FeedbackType } from "../repositories/feedback";
import { isAdminSession } from "./auth";
import { notifyAdminOfFeedback } from "./adminNotifications";

export type { Feedback, FeedbackType } from "../repositories/feedback";

/**
 * Production hardening (see docs/decisions/0039-embed-logo-signup-
 * notifications-and-feedback.md) — an extremely simple business feedback/
 * bug-report channel. Deliberately NOT a ticketing system: no status
 * workflow, no threaded replies, no assignment — just "say something to
 * Kyle," persisted so nothing is lost even if the admin notification
 * email never arrives.
 */

const FEEDBACK_TYPES: readonly FeedbackType[] = ["bug", "suggestion", "feedback"];
const MAX_MESSAGE_LENGTH = 4000;
const MAX_SOURCE_PATH_LENGTH = 300;

export interface SubmitFeedbackInput {
  type: string;
  message: string;
  contactMe: boolean;
  /** The page the submitter was on, e.g. "/dashboard/quotes/quote_123" — never an arbitrary external URL, never page CONTENTS. Best-effort; omitted entirely if not safely available. */
  sourcePath?: string;
}

function validateFeedbackInput(input: SubmitFeedbackInput): { type: FeedbackType; message: string } {
  if (!FEEDBACK_TYPES.includes(input.type as FeedbackType)) {
    throw new Error(`Invalid feedback type. Expected one of: ${FEEDBACK_TYPES.join(", ")}.`);
  }
  const message = input.message.trim();
  if (message.length === 0) {
    throw new Error("Please enter a message.");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }
  return { type: input.type as FeedbackType, message };
}

/**
 * Best-effort, single-process cooldown against accidental double-submit
 * or a scripted hammering of the Server Action — same documented caveat
 * (not a distributed rate limiter) as `quoteSmsAlert.ts`'s `isThrottled`/
 * `passwordReset.ts`'s identical pattern. Keyed by user, not business —
 * two different users at the same business submitting back-to-back is a
 * legitimate, separate case this must not block.
 */
const COOLDOWN_MS = 15_000;
const lastSubmittedAt = new Map<string, number>();

function isThrottled(userId: string): boolean {
  const last = lastSubmittedAt.get(userId);
  return last !== undefined && Date.now() - last < COOLDOWN_MS;
}

/**
 * `businessId`/`userId` always come from the caller's own validated
 * `session` — never from `input`, which has no such fields at all — so a
 * business can only ever submit feedback as itself. Persists first,
 * notifies second (and the notification failing never undoes or hides
 * the persisted row — see `notifyAdminOfFeedback`'s own comment).
 */
export async function submitFeedback(
  db: Queryable,
  session: AuthSession,
  input: SubmitFeedbackInput,
  onAdminNotified?: (finished: Promise<void>) => void,
): Promise<Feedback> {
  const { type, message } = validateFeedbackInput(input);

  if (isThrottled(session.userId)) {
    throw new Error("Please wait a moment before submitting again.");
  }
  lastSubmittedAt.set(session.userId, Date.now());

  const sourcePath =
    typeof input.sourcePath === "string" && input.sourcePath.length > 0
      ? input.sourcePath.slice(0, MAX_SOURCE_PATH_LENGTH)
      : undefined;

  const feedback = await feedbackRepo.createFeedback(db, {
    businessId: session.businessId,
    userId: session.userId,
    type,
    message,
    sourcePath,
    contactMe: Boolean(input.contactMe),
  });

  // Outside any try/catch that could affect the row already persisted
  // above — a problem here (synchronous or not) must never look like the
  // feedback submission itself failed. Same "never let a notification
  // problem undo a real, already-committed action" rule `signUp`'s
  // notifyAdminOfNewSignup call applies.
  try {
    const { finished } = notifyAdminOfFeedback(feedback);
    onAdminNotified?.(finished);
  } catch (err) {
    console.error("submitFeedback: notifyAdminOfFeedback failed synchronously:", err);
  }

  return feedback;
}

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

/** The admin dashboard's feedback list — every business's submissions, newest first. Gated exactly like every other admin read (see `services/admin.ts`'s identical `requireAdmin`). */
export async function listFeedbackAdmin(db: Queryable, session: AuthSession): Promise<Feedback[]> {
  await requireAdmin(db, session);
  return feedbackRepo.listAllFeedback(db);
}
