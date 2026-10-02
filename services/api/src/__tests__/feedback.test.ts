import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { submitFeedback, listFeedbackAdmin } from "../services/feedback";
import * as adminNotifications from "../services/adminNotifications";

const getDb = useTestDb();

async function setUp(businessName = "Sparkle Windows") {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName,
    ownerEmail: `${businessName.toLowerCase().replace(/\s+/g, "-")}@example.com`,
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("submitFeedback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists feedback scoped to the caller's own business and user, never anything client-supplied", async () => {
    const { db, session } = await setUp();
    vi.spyOn(adminNotifications, "notifyAdminOfFeedback").mockReturnValue({ finished: Promise.resolve() });

    const feedback = await submitFeedback(db, session, {
      type: "bug",
      message: "The photo gallery is broken.",
      contactMe: true,
      sourcePath: "/dashboard/quotes/quote_123",
    });

    expect(feedback.businessId).toBe(session.businessId);
    expect(feedback.userId).toBe(session.userId);
    expect(feedback.type).toBe("bug");
    expect(feedback.message).toBe("The photo gallery is broken.");
    expect(feedback.contactMe).toBe(true);
    expect(feedback.sourcePath).toBe("/dashboard/quotes/quote_123");
    expect(feedback.businessName).toBe("Sparkle Windows");
  });

  it("rejects an invalid type", async () => {
    const { db, session } = await setUp();
    await expect(
      submitFeedback(db, session, { type: "complaint", message: "hi", contactMe: false }),
    ).rejects.toThrow(/invalid feedback type/i);
  });

  it("rejects an empty (or whitespace-only) message", async () => {
    const { db, session } = await setUp();
    await expect(submitFeedback(db, session, { type: "feedback", message: "   ", contactMe: false })).rejects.toThrow(
      /please enter a message/i,
    );
  });

  it("rejects a message over the length ceiling", async () => {
    const { db, session } = await setUp();
    await expect(
      submitFeedback(db, session, { type: "feedback", message: "x".repeat(4001), contactMe: false }),
    ).rejects.toThrow(/4000 characters or fewer/i);
  });

  it("persists the feedback even when notifyAdminOfFeedback throws synchronously — persist first, notify second, and a notification problem never loses the submission", async () => {
    const { db, session } = await setUp();
    vi.spyOn(adminNotifications, "notifyAdminOfFeedback").mockImplementation(() => {
      throw new Error("notification subsystem exploded");
    });

    const feedback = await submitFeedback(db, session, {
      type: "suggestion",
      message: "Add dark mode.",
      contactMe: false,
    });

    expect(feedback.id).toBeTruthy();
    await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [session.userId]);
    const listed = await listFeedbackAdmin(db, session);
    expect(listed.some((f) => f.id === feedback.id)).toBe(true);
  });

  it("enforces a short cooldown against accidental double-submit from the same user", async () => {
    const { db, session } = await setUp();
    vi.spyOn(adminNotifications, "notifyAdminOfFeedback").mockReturnValue({ finished: Promise.resolve() });

    await submitFeedback(db, session, { type: "feedback", message: "First.", contactMe: false });
    await expect(
      submitFeedback(db, session, { type: "feedback", message: "Second, immediately after.", contactMe: false }),
    ).rejects.toThrow(/wait a moment/i);
  });
});

describe("listFeedbackAdmin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a non-admin session", async () => {
    const { db, session } = await setUp();
    await expect(listFeedbackAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("an admin sees feedback across every business, newest first", async () => {
    const { db, session: businessA } = await setUp("Business A");
    const { session: businessB } = await setUp("Business B");
    vi.spyOn(adminNotifications, "notifyAdminOfFeedback").mockReturnValue({ finished: Promise.resolve() });

    await submitFeedback(db, businessA, { type: "bug", message: "From A.", contactMe: false });
    await submitFeedback(db, businessB, { type: "suggestion", message: "From B.", contactMe: false });

    // Promote business A's own user to admin directly (mirrors how
    // grantAdmin.ts would in production) — this test only needs an
    // admin SESSION, not the full CLI tooling around it.
    await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [businessA.userId]);

    const all = await listFeedbackAdmin(db, businessA);
    expect(all.map((f) => f.message).sort()).toEqual(["From A.", "From B."]);
  });
});
