import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

export type FeedbackType = "bug" | "suggestion" | "feedback";

/**
 * Always hydrated with the submitting business's name and user's email
 * (a JOIN, same convenience pattern `repositories/quotes.ts`'s
 * `toQuote` already uses for `quote.customer`) — the admin list view and
 * the admin notification email both need "who submitted this" without a
 * separate lookup per row.
 */
export interface Feedback {
  id: string;
  businessId: string;
  businessName: string;
  userId: string;
  userEmail: string;
  type: FeedbackType;
  message: string;
  sourcePath?: string;
  contactMe: boolean;
  createdAt: string;
}

export interface CreateFeedbackInput {
  businessId: string;
  userId: string;
  type: FeedbackType;
  message: string;
  sourcePath?: string;
  contactMe: boolean;
}

interface FeedbackRow {
  id: string;
  business_id: string;
  user_id: string;
  type: string;
  message: string;
  source_path: string | null;
  contact_me: boolean;
  created_at: string;
  business_name: string;
  user_email: string;
}

const SELECT_FEEDBACK_WITH_JOINS = `
  SELECT f.*, b.name AS business_name, u.email AS user_email
  FROM feedback f
  JOIN businesses b ON b.id = f.business_id
  JOIN users u ON u.id = f.user_id
`;

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    userId: row.user_id,
    userEmail: row.user_email,
    type: row.type as FeedbackType,
    message: row.message,
    sourcePath: row.source_path ?? undefined,
    contactMe: row.contact_me,
    createdAt: row.created_at,
  };
}

export async function createFeedback(db: Queryable, input: CreateFeedbackInput): Promise<Feedback> {
  const id = makeId("feedback");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO feedback (id, business_id, user_id, type, message, source_path, contact_me, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.businessId, input.userId, input.type, input.message, input.sourcePath ?? null, input.contactMe, now],
  );
  const created = await getFeedbackById(db, id);
  if (!created) throw new Error("Failed to read back the feedback that was just created.");
  return created;
}

export async function getFeedbackById(db: Queryable, id: string): Promise<Feedback | undefined> {
  const result = await db.query<FeedbackRow>(`${SELECT_FEEDBACK_WITH_JOINS} WHERE f.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toFeedback(row) : undefined;
}

/** Admin-only (see services/feedback.ts's `listFeedbackAdmin`, which gates this) — deliberately NOT scoped by business_id; this is the one place feedback is read across every tenant, by design. */
export async function listAllFeedback(db: Queryable, limit = 200): Promise<Feedback[]> {
  const result = await db.query<FeedbackRow>(`${SELECT_FEEDBACK_WITH_JOINS} ORDER BY f.created_at DESC LIMIT $1`, [limit]);
  return result.rows.map(toFeedback);
}
