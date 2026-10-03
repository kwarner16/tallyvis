import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import type { AuthSession } from "../auth/session";
import { signUp } from "../services/auth";
import { setUserIsAdmin } from "../repositories/users";
import { createSalesProspect } from "../repositories/salesProspects";
import {
  startSalesCallAdmin,
  endSalesCallAdmin,
  getActiveSalesCallAdmin,
  getSalesCallDetailAdmin,
  listFollowUpsDueAdmin,
  getSalesMetricsAdmin,
  getTodaySalesSummaryAdmin,
} from "../services/salesCalls";
import { createSalesCall } from "../repositories/salesCalls";

const getDb = useTestDb();

async function newAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Admin Co",
    ownerEmail: `admin-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  await setUserIsAdmin(db, session.userId, true);
  return { db, session };
}

async function newNonAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Regular Co",
    ownerEmail: `regular-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  return { db, session };
}

async function newProspect(db: Awaited<ReturnType<typeof getDb>>, phoneSuffix = "0001") {
  return createSalesProspect(db, { businessName: `Test Prospect ${phoneSuffix}`, phone: `352-555-${phoneSuffix}`, normalizedPhone: `+1352555${phoneSuffix}` });
}

describe("startSalesCallAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(startSalesCallAdmin(db, session, "salesprospect_whatever")).rejects.toThrow(/admin access required/i);
  });

  it("creates a call with a server-stamped startedAt and no outcome yet", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);

    const call = await startSalesCallAdmin(db, session, prospect.id);
    expect(call.prospectId).toBe(prospect.id);
    expect(call.startedByUserId).toBe(session.userId);
    expect(call.startedAt).toBeTruthy();
    expect(call.endedAt).toBeUndefined();
    expect(call.outcome).toBeUndefined();
  });

  it("rejects starting a call for a nonexistent prospect", async () => {
    const { db, session } = await newAdmin();
    await expect(startSalesCallAdmin(db, session, "salesprospect_does-not-exist")).rejects.toThrow(/not found/i);
  });

  it("returns the SAME active call on a second start attempt, rather than creating a duplicate active call (idempotency)", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);

    const first = await startSalesCallAdmin(db, session, prospect.id);
    const second = await startSalesCallAdmin(db, session, prospect.id);
    expect(second.id).toBe(first.id);
  });

  it("returns the existing active call even when a DIFFERENT prospect is requested — never silently opens a second active call", async () => {
    const { db, session } = await newAdmin();
    const prospectA = await newProspect(db, "0001");
    const prospectB = await newProspect(db, "0002");

    const first = await startSalesCallAdmin(db, session, prospectA.id);
    const second = await startSalesCallAdmin(db, session, prospectB.id);
    expect(second.id).toBe(first.id);
    expect(second.prospectId).toBe(prospectA.id);
  });

  it("the database itself refuses two simultaneous active calls for the same admin (the partial unique index), bypassing the service-layer check entirely", async () => {
    const { db, session } = await newAdmin();
    const prospectA = await newProspect(db, "0001");
    const prospectB = await newProspect(db, "0002");

    await createSalesCall(db, prospectA.id, session.userId);
    await expect(createSalesCall(db, prospectB.id, session.userId)).rejects.toThrow();
  });

  it("allows a NEW active call once the previous one has ended", async () => {
    const { db, session } = await newAdmin();
    const prospectA = await newProspect(db, "0001");
    const prospectB = await newProspect(db, "0002");

    const first = await startSalesCallAdmin(db, session, prospectA.id);
    await endSalesCallAdmin(db, session, first.id, { outcome: "no_answer" });

    const second = await startSalesCallAdmin(db, session, prospectB.id);
    expect(second.id).not.toBe(first.id);
    expect(second.prospectId).toBe(prospectB.id);
  });
});

describe("endSalesCallAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(endSalesCallAdmin(db, session, "salescall_whatever", { outcome: "no_answer" })).rejects.toThrow(/admin access required/i);
  });

  it("persists outcome, notes, objections, and follow-up together, and computes duration from the real elapsed time", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);

    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ended = await endSalesCallAdmin(db, session, call.id, {
      outcome: "interested",
      notes: "Likes the photo estimator.",
      objections: ["has_software", "needs_to_think"],
      followUpAt,
    });

    expect(ended.outcome).toBe("interested");
    expect(ended.notes).toBe("Likes the photo estimator.");
    expect(ended.objections).toEqual(["has_software", "needs_to_think"]);
    expect(ended.followUpAt).toBe(followUpAt);
    expect(ended.endedAt).toBeTruthy();
    expect(ended.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("rejects an unknown outcome", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await expect(endSalesCallAdmin(db, session, call.id, { outcome: "maybe_interested" })).rejects.toThrow(/unknown call outcome/i);
  });

  it("rejects an unknown objection", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await expect(endSalesCallAdmin(db, session, call.id, { outcome: "interested", objections: ["not_a_real_objection"] })).rejects.toThrow(
      /unknown objection/i,
    );
  });

  it("rejects an unparseable follow-up date", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await expect(endSalesCallAdmin(db, session, call.id, { outcome: "follow_up", followUpAt: "not-a-date" })).rejects.toThrow(
      /valid follow-up/i,
    );
  });

  it("de-duplicates repeated objection keys", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    const ended = await endSalesCallAdmin(db, session, call.id, { outcome: "interested", objections: ["price", "price"] });
    expect(ended.objections).toEqual(["price"]);
  });

  it("rejects ending an already-ended call a second time", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call.id, { outcome: "no_answer" });
    await expect(endSalesCallAdmin(db, session, call.id, { outcome: "interested" })).rejects.toThrow(/not found|already ended/i);
  });

  it("frees up the active-call slot once ended, confirmed via getActiveSalesCallAdmin", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    expect((await getActiveSalesCallAdmin(db, session))?.id).toBe(call.id);

    await endSalesCallAdmin(db, session, call.id, { outcome: "no_answer" });
    expect(await getActiveSalesCallAdmin(db, session)).toBeUndefined();
  });
});

describe("getSalesCallDetailAdmin", () => {
  it("includes prior calls for the same prospect, excluding the current call itself", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);

    const first = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, first.id, { outcome: "no_answer" });
    const second = await startSalesCallAdmin(db, session, prospect.id);

    const detail = await getSalesCallDetailAdmin(db, session, second.id);
    expect(detail?.priorCalls).toHaveLength(1);
    expect(detail?.priorCalls[0]!.id).toBe(first.id);
    expect(detail?.priorCalls.some((c) => c.id === second.id)).toBe(false);
  });
});

describe("listFollowUpsDueAdmin", () => {
  it("surfaces a due/overdue follow-up with the prospect and its last call", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call.id, {
      outcome: "follow_up",
      followUpAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    const due = await listFollowUpsDueAdmin(db, session);
    expect(due).toHaveLength(1);
    expect(due[0]!.prospect.id).toBe(prospect.id);
    expect(due[0]!.lastCall.outcome).toBe("follow_up");
  });

  it("excludes a follow-up scheduled in the future", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call.id, {
      outcome: "follow_up",
      followUpAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(await listFollowUpsDueAdmin(db, session)).toHaveLength(0);
  });

  it("only the prospect's MOST RECENT call counts — a later call with no follow-up clears an earlier stale one", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db);

    const first = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, first.id, {
      outcome: "follow_up",
      followUpAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    const second = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, second.id, { outcome: "not_interested" });

    expect(await listFollowUpsDueAdmin(db, session)).toHaveLength(0);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(listFollowUpsDueAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });
});

describe("getSalesMetricsAdmin / getTodaySalesSummaryAdmin", () => {
  async function seedCalls(db: Awaited<ReturnType<typeof getDb>>, session: AuthSession) {
    const outcomes = ["no_answer", "voicemail", "interested", "interested", "demo_requested", "follow_up", "signed_up"] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const prospect = await createSalesProspect(db, { businessName: `Prospect ${index}`, phone: `352-555-00${10 + index}` });
      const call = await startSalesCallAdmin(db, session, prospect.id);
      // Only the "follow_up" outcome call gets an actual followUpAt — a
      // due follow-up is driven entirely by that timestamp, never implied
      // merely by the outcome label (see services/salesCalls.ts).
      const followUpAt = outcome === "follow_up" ? new Date(Date.now() - 60 * 1000).toISOString() : undefined;
      await endSalesCallAdmin(db, session, call.id, { outcome, followUpAt });
    }
  }

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(getSalesMetricsAdmin(db, session, "all")).rejects.toThrow(/admin access required/i);
    await expect(getTodaySalesSummaryAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("derives every metric correctly from a known, mixed set of completed calls", async () => {
    const { db, session } = await newAdmin();
    await seedCalls(db, session);

    const metrics = await getSalesMetricsAdmin(db, session, "all");
    expect(metrics.totalCalls).toBe(7);
    expect(metrics.answeredCount).toBe(5); // everything except no_answer/voicemail
    expect(metrics.noAnswerCount).toBe(1);
    expect(metrics.voicemailCount).toBe(1);
    expect(metrics.interestedCount).toBe(2);
    expect(metrics.demoCount).toBe(1);
    expect(metrics.followUpCount).toBe(1);
    expect(metrics.signedUpCount).toBe(1);
    expect(metrics.callToSignupRate).toBeCloseTo(1 / 7);
    expect(metrics.conversationToSignupRate).toBeCloseTo(1 / 5);
    expect(metrics.averageCallDurationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("call -> signup rate is exactly 0 (never NaN) when there are zero calls", async () => {
    const { db, session } = await newAdmin();
    const metrics = await getSalesMetricsAdmin(db, session, "all");
    expect(metrics.totalCalls).toBe(0);
    expect(metrics.callToSignupRate).toBe(0);
    expect(metrics.conversationToSignupRate).toBeUndefined();
    expect(metrics.averageCallDurationSeconds).toBeUndefined();
  });

  it("'today' period includes calls made today and excludes nothing from the current UTC day", async () => {
    const { db, session } = await newAdmin();
    await seedCalls(db, session);
    const todayMetrics = await getSalesMetricsAdmin(db, session, "today");
    expect(todayMetrics.totalCalls).toBe(7);
  });

  it("getTodaySalesSummaryAdmin counts today's outcomes and today's due follow-ups separately from calls-today", async () => {
    const { db, session } = await newAdmin();
    await seedCalls(db, session);

    const summary = await getTodaySalesSummaryAdmin(db, session);
    expect(summary.callsToday).toBe(7);
    expect(summary.answeredToday).toBe(5);
    expect(summary.interestedToday).toBe(2);
    expect(summary.signedUpToday).toBe(1);
    expect(summary.followUpsDueCount).toBe(1); // the one "follow_up" outcome call, due immediately (no explicit followUpAt passed in seedCalls)
  });
});
