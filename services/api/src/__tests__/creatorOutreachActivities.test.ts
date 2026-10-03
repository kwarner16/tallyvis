import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { setUserIsAdmin } from "../repositories/users";
import { commitCreatorProspectImportAdmin, getCreatorProspectDetailAdmin } from "../services/creatorProspects";
import { findCreatorProspectsByNormalizedEmails, createCreatorProspect } from "../repositories/creatorProspects";
import {
  recordCreatorOutreachActivityAdmin,
  listCreatorFollowUpsDueAdmin,
  getCreatorOutreachMetricsAdmin,
} from "../services/creatorOutreachActivities";

const getDb = useTestDb();

let counter = 0;
function uniqueN(): number {
  counter += 1;
  return counter;
}
function uniqueEmail(): string {
  return `outreach${uniqueN()}@example.com`;
}

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

async function newProspect(db: Awaited<ReturnType<typeof getDb>>, displayName: string) {
  return createCreatorProspect(db, { displayName, contactEmail: uniqueEmail(), normalizedEmail: uniqueEmail() });
}

describe("recordCreatorOutreachActivityAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(recordCreatorOutreachActivityAdmin(db, session, "creatorprospect_whatever", { status: "email1_sent" })).rejects.toThrow(
      /admin access required/i,
    );
  });

  it("records an activity and updates the prospect's status/last-contacted/follow-up snapshot together", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Activity Test Creator");
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const updated = await recordCreatorOutreachActivityAdmin(db, session, prospect.id, {
      status: "interested",
      notes: "Wants to know how referral attribution works.",
      followUpAt,
    });

    expect(updated.status).toBe("interested");
    expect(updated.followUpAt).toBe(followUpAt);
    expect(updated.lastContactedAt).toBeTruthy();

    const detail = await getCreatorProspectDetailAdmin(db, session, prospect.id);
    expect(detail?.activities).toHaveLength(1);
    expect(detail?.activities[0]).toMatchObject({ status: "interested", notes: "Wants to know how referral attribution works." });
  });

  it("rejects an unknown status", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Bad Status Creator");
    await expect(recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "super_interested" })).rejects.toThrow(
      /unknown outreach status/i,
    );
  });

  it("rejects an unparseable follow-up date", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Bad Follow Up Creator");
    await expect(
      recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "follow_up", followUpAt: "not-a-date" }),
    ).rejects.toThrow(/valid follow-up/i);
  });

  it("a later activity with no follow-up clears a previously scheduled one", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Clear Follow Up Creator");

    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, {
      status: "follow_up",
      followUpAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const updated = await recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "replied" });
    expect(updated.followUpAt).toBeUndefined();
  });

  it("builds a multi-entry chronological history across several activities, most recent first", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "History Creator");

    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "email1_sent" });
    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "awaiting_reply" });
    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, { status: "replied", notes: "Asked a question." });

    const detail = await getCreatorProspectDetailAdmin(db, session, prospect.id);
    expect(detail?.activities.map((a) => a.status)).toEqual(["replied", "awaiting_reply", "email1_sent"]);
  });
});

describe("listCreatorFollowUpsDueAdmin", () => {
  it("surfaces a due/overdue follow-up with the prospect and its last activity", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Due Follow Up Creator");
    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, {
      status: "follow_up",
      followUpAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    const due = await listCreatorFollowUpsDueAdmin(db, session);
    expect(due.some((entry) => entry.prospect.id === prospect.id)).toBe(true);
  });

  it("excludes a follow-up scheduled in the future", async () => {
    const { db, session } = await newAdmin();
    const prospect = await newProspect(db, "Future Follow Up Creator");
    await recordCreatorOutreachActivityAdmin(db, session, prospect.id, {
      status: "follow_up",
      followUpAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const due = await listCreatorFollowUpsDueAdmin(db, session);
    expect(due.some((entry) => entry.prospect.id === prospect.id)).toBe(false);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(listCreatorFollowUpsDueAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });
});

describe("getCreatorOutreachMetricsAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(getCreatorOutreachMetricsAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("derives every metric correctly from a known, mixed set of prospects/activities", async () => {
    const { db, session } = await newAdmin();

    const notContacted = await newProspect(db, "Metrics Not Contacted");
    void notContacted;

    const interested = await newProspect(db, "Metrics Interested");
    await recordCreatorOutreachActivityAdmin(db, session, interested.id, { status: "interested" });

    const notInterested = await newProspect(db, "Metrics Not Interested");
    await recordCreatorOutreachActivityAdmin(db, session, notInterested.id, { status: "not_interested" });

    const awaiting = await newProspect(db, "Metrics Awaiting");
    await recordCreatorOutreachActivityAdmin(db, session, awaiting.id, { status: "email1_sent" });

    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nMetrics Converted Creator | ${email}`);
    const [converted] = await findCreatorProspectsByNormalizedEmails(db, [email]);
    const { convertProspectToCreatorAdmin } = await import("../services/creatorProspects");
    await convertProspectToCreatorAdmin(db, session, converted!.id, { slug: `metricsconvert${uniqueN()}`, email: uniqueEmail() });

    const metrics = await getCreatorOutreachMetricsAdmin(db, session);
    expect(metrics.totalProspects).toBe(5);
    expect(metrics.contacted).toBe(4); // everything except notContacted
    expect(metrics.interested).toBe(1);
    expect(metrics.notInterested).toBe(1);
    expect(metrics.converted).toBe(1);
    expect(metrics.awaitingReply).toBe(1);
    expect(metrics.replied).toBe(3); // interested + notInterested + converted
    expect(metrics.outreachToReplyRate).toBeCloseTo(3 / 4);
    expect(metrics.outreachToInterestedRate).toBeCloseTo(1 / 4);
    expect(metrics.outreachToConversionRate).toBeCloseTo(1 / 5);
  });

  it("every rate is exactly 0 (never NaN) when there are zero prospects", async () => {
    const { db, session } = await newAdmin();
    const metrics = await getCreatorOutreachMetricsAdmin(db, session);
    expect(metrics.totalProspects).toBe(0);
    expect(metrics.outreachToReplyRate).toBe(0);
    expect(metrics.outreachToInterestedRate).toBe(0);
    expect(metrics.outreachToConversionRate).toBe(0);
  });
});
