import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { setUserIsAdmin } from "../repositories/users";
import {
  previewProspectImportAdmin,
  commitProspectImportAdmin,
  updateSalesProspectAdmin,
  listProspectQueueAdmin,
  getSalesProspectDetailAdmin,
} from "../services/salesProspects";
import { startSalesCallAdmin, endSalesCallAdmin } from "../services/salesCalls";
import { findSalesProspectByNormalizedPhone } from "../repositories/salesProspects";

const getDb = useTestDb();

/**
 * This test harness gives every test FILE its own schema, not every test
 * CASE — see docs/decisions/0021-postgres-migration.md's own comment on
 * why. Every phone number used below must therefore be unique across the
 * WHOLE file, never reused between `it()` blocks, or an earlier test's
 * row would be found as an "existing" duplicate by a later, unrelated
 * test. This counter is the single source of fresh 10-digit numbers.
 */
let phoneCounter = 0;
function uniqueDigits(): string {
  phoneCounter += 1;
  return `352555${String(1000 + phoneCounter).slice(-4)}`;
}
function uniquePhone(): string {
  return formatDashes(uniqueDigits());
}
function formatDashes(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
function formatParens(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
function formatWithCountryCode(digits: string): string {
  return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}
function toE164(digits: string): string {
  return `+1${digits}`;
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

describe("previewProspectImportAdmin / commitProspectImportAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    const list = `Business Name | Phone\nAmazing View | ${uniquePhone()}`;
    await expect(previewProspectImportAdmin(db, session, list)).rejects.toThrow(/admin access required/i);
    await expect(commitProspectImportAdmin(db, session, list)).rejects.toThrow(/admin access required/i);
  });

  it("classifies every row as new on a first-time import", async () => {
    const { db, session } = await newAdmin();
    const list = `Business Name | Owner | Phone | Email | Website | City | State | Source
Amazing View Window Cleaning | Dana | ${uniquePhone()} | dana@example.com | amazingview.com | Ocala | FL | ChatGPT
Crystal Clear Windows | Sam | ${uniquePhone()} | | | Gainesville | FL | ChatGPT`;

    const preview = await previewProspectImportAdmin(db, session, list);
    expect(preview.counts).toEqual({ new: 2, duplicate: 0, possible_duplicate: 0, invalid: 0 });
    expect(preview.rows.every((row) => row.status === "new")).toBe(true);
  });

  it("commits only the classified rows, creating real prospect rows with normalized phones", async () => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    const list = `Business Name | Owner | Phone | Email | Website | City | State | Source
Amazing View Window Cleaning | Dana | ${formatDashes(digits)} | dana@example.com | amazingview.com | Ocala | FL | ChatGPT
Crystal Clear Windows | Sam | ${uniquePhone()} | | | Gainesville | FL | ChatGPT`;

    const result = await commitProspectImportAdmin(db, session, list);
    expect(result.createdCount).toBe(2);

    const stored = await findSalesProspectByNormalizedPhone(db, toE164(digits));
    expect(stored?.businessName).toBe("Amazing View Window Cleaning");
    expect(stored?.email).toBe("dana@example.com");
  });

  it("re-importing the EXACT same list a second time creates zero new prospects", async () => {
    const { db, session } = await newAdmin();
    const list = `Business Name | Phone
Reimport Test Biz A | ${uniquePhone()}
Reimport Test Biz B | ${uniquePhone()}`;

    await commitProspectImportAdmin(db, session, list);

    const second = await commitProspectImportAdmin(db, session, list);
    expect(second.createdCount).toBe(0);
    expect(second.counts.duplicate).toBe(2);

    const preview = await previewProspectImportAdmin(db, session, list);
    expect(preview.counts.duplicate).toBe(2);
    expect(preview.counts.new).toBe(0);
  });

  it.each([
    ["parens", "dashes"],
    ["dashes", "plain"],
    ["plain", "withCountryCode"],
    ["withCountryCode", "parens"],
  ] as const)("recognizes the %s and %s formats of the SAME number as the SAME phone for duplicate detection", async (formatA, formatB) => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    const formats = {
      parens: formatParens(digits),
      dashes: formatDashes(digits),
      plain: digits,
      withCountryCode: formatWithCountryCode(digits),
    };

    const bizName = `Format Test Biz ${digits}`;
    await commitProspectImportAdmin(db, session, `Business Name | Phone\n${bizName} | ${formats[formatA]}`);

    const preview = await previewProspectImportAdmin(db, session, `Business Name | Phone\n${bizName} | ${formats[formatB]}`);
    expect(preview.counts.duplicate).toBe(1);
    expect(preview.rows[0]!.status).toBe("duplicate");
    expect(preview.rows[0]!.existingProspect?.businessName).toBe(bizName);
  });

  it("a duplicate's preview surfaces the existing prospect's last call outcome/notes ('Already contacted')", async () => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    const bizName = `Already Contacted Biz ${digits}`;
    const imported = await commitProspectImportAdmin(db, session, `Business Name | Phone\n${bizName} | ${formatDashes(digits)}`);
    const prospectId = (await findSalesProspectByNormalizedPhone(db, toE164(digits)))!.id;
    expect(imported.createdCount).toBe(1);

    const call = await startSalesCallAdmin(db, session, prospectId);
    await endSalesCallAdmin(db, session, call.id, { outcome: "interested", notes: "Asked to see the demo when ready." });

    const preview = await previewProspectImportAdmin(db, session, `Business Name | Phone\n${bizName} | ${formatParens(digits)}`);
    expect(preview.rows[0]!.status).toBe("duplicate");
    expect(preview.rows[0]!.existingLastCall?.outcome).toBe("interested");
    expect(preview.rows[0]!.existingLastCall?.notes).toBe("Asked to see the demo when ready.");
  });

  it("flags a different business with the SAME phone twice within one pasted batch as a duplicate, importing only the first occurrence", async () => {
    const { db, session } = await newAdmin();
    const phone = uniquePhone();
    const text = `Business Name | Phone
Batch Dup Biz A | ${phone}
Batch Dup Biz B | ${phone}`;

    const result = await commitProspectImportAdmin(db, session, text);
    expect(result.createdCount).toBe(1);
    expect(result.counts).toEqual({ new: 1, duplicate: 1, possible_duplicate: 0, invalid: 0 });
  });

  it("flags a matching business name with a DIFFERENT phone as a possible duplicate, not blocked outright", async () => {
    const { db, session } = await newAdmin();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nPossible Dup Biz | ${uniquePhone()}`);

    const preview = await previewProspectImportAdmin(db, session, `Business Name | Phone\nPossible Dup Biz | ${uniquePhone()}`);
    expect(preview.counts.possible_duplicate).toBe(1);
    expect(preview.counts.new).toBe(0);
  });

  it("does not treat business name alone as a duplicate key for a genuinely different business with a different phone", async () => {
    const { db, session } = await newAdmin();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nSparkle Windows Inc | ${uniquePhone()}`);

    const preview = await previewProspectImportAdmin(db, session, `Business Name | Phone\nTotally Different Co | ${uniquePhone()}`);
    expect(preview.counts.new).toBe(1);
  });

  it("marks a row with no phone number as invalid and never imports it", async () => {
    const { db, session } = await newAdmin();
    const result = await commitProspectImportAdmin(db, session, "Business Name | Phone\nNo Phone Co |");
    expect(result.createdCount).toBe(0);
    expect(result.counts.invalid).toBe(1);
    expect(result.rows[0]!.errors).toContain("Missing phone number.");
  });

  it("marks a row with an unrecognizable phone number as invalid", async () => {
    const { db, session } = await newAdmin();
    const result = await commitProspectImportAdmin(db, session, "Business Name | Phone\nBad Phone Co | not-a-phone-number");
    expect(result.createdCount).toBe(0);
    expect(result.counts.invalid).toBe(1);
  });

  it("marks a row with no business name as invalid", async () => {
    const { db, session } = await newAdmin();
    const result = await commitProspectImportAdmin(db, session, `Business Name | Phone\n | ${uniquePhone()}`);
    expect(result.createdCount).toBe(0);
    expect(result.counts.invalid).toBe(1);
  });
});

describe("updateSalesProspectAdmin", () => {
  it("corrects contact info an import got wrong, and re-normalizes a changed phone number", async () => {
    const { db, session } = await newAdmin();
    const originalDigits = uniqueDigits();
    const newDigits = uniqueDigits();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nUpdate Test Biz ${originalDigits} | ${formatDashes(originalDigits)}`);
    const prospect = (await findSalesProspectByNormalizedPhone(db, toE164(originalDigits)))!;

    const updated = await updateSalesProspectAdmin(db, session, prospect.id, {
      businessName: "Amazing View Window Cleaning LLC",
      phone: formatDashes(newDigits),
    });
    expect(updated.businessName).toBe("Amazing View Window Cleaning LLC");
    expect(updated.phone).toBe(formatDashes(newDigits));

    const byOldPhone = await findSalesProspectByNormalizedPhone(db, toE164(originalDigits));
    const byNewPhone = await findSalesProspectByNormalizedPhone(db, toE164(newDigits));
    expect(byOldPhone).toBeUndefined();
    expect(byNewPhone?.id).toBe(prospect.id);
  });

  it("rejects clearing the business name entirely", async () => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nClear Name Test Biz ${digits} | ${formatDashes(digits)}`);
    const prospect = (await findSalesProspectByNormalizedPhone(db, toE164(digits)))!;
    await expect(updateSalesProspectAdmin(db, session, prospect.id, { businessName: "" })).rejects.toThrow(/business name/i);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(updateSalesProspectAdmin(db, session, "salesprospect_whatever", { businessName: "X" })).rejects.toThrow(
      /admin access required/i,
    );
  });
});

describe("listProspectQueueAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(listProspectQueueAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("orders a due/overdue follow-up ahead of a never-contacted prospect, which in turn outranks one with no pending follow-up", async () => {
    const { db, session } = await newAdmin();
    const neverDigits = uniqueDigits();
    const overdueDigits = uniqueDigits();
    const workedDigits = uniqueDigits();
    await commitProspectImportAdmin(
      db,
      session,
      `Business Name | Phone
Never Contacted | ${formatDashes(neverDigits)}
Has Overdue Follow Up | ${formatDashes(overdueDigits)}
Already Worked No Follow Up | ${formatDashes(workedDigits)}`,
    );

    const overdue = (await findSalesProspectByNormalizedPhone(db, toE164(overdueDigits)))!;
    const worked = (await findSalesProspectByNormalizedPhone(db, toE164(workedDigits)))!;

    const overdueCall = await startSalesCallAdmin(db, session, overdue.id);
    await endSalesCallAdmin(db, session, overdueCall.id, {
      outcome: "follow_up",
      followUpAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const workedCall = await startSalesCallAdmin(db, session, worked.id);
    await endSalesCallAdmin(db, session, workedCall.id, { outcome: "not_interested" });

    const queue = await listProspectQueueAdmin(db, session);
    const order = queue.map((entry) => entry.prospect.businessName);
    expect(order.indexOf("Has Overdue Follow Up")).toBeLessThan(order.indexOf("Never Contacted"));
    expect(order.indexOf("Never Contacted")).toBeLessThan(order.indexOf("Already Worked No Follow Up"));
    expect(queue.find((e) => e.prospect.businessName === "Has Overdue Follow Up")?.followUpDue).toBe(true);
  });

  it("does not mark a FUTURE follow-up as due", async () => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nFuture Follow Up | ${formatDashes(digits)}`);
    const prospect = (await findSalesProspectByNormalizedPhone(db, toE164(digits)))!;
    const call = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call.id, {
      outcome: "follow_up",
      followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const queue = await listProspectQueueAdmin(db, session);
    expect(queue.find((e) => e.prospect.id === prospect.id)?.followUpDue).toBe(false);
  });
});

describe("getSalesProspectDetailAdmin", () => {
  it("returns the prospect and its full chronological call history", async () => {
    const { db, session } = await newAdmin();
    const digits = uniqueDigits();
    await commitProspectImportAdmin(db, session, `Business Name | Phone\nHistory Test Biz ${digits} | ${formatDashes(digits)}`);
    const prospect = (await findSalesProspectByNormalizedPhone(db, toE164(digits)))!;

    const call1 = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call1.id, { outcome: "no_answer" });
    const call2 = await startSalesCallAdmin(db, session, prospect.id);
    await endSalesCallAdmin(db, session, call2.id, { outcome: "interested", notes: "Likes the photo estimator." });

    const detail = await getSalesProspectDetailAdmin(db, session, prospect.id);
    expect(detail?.calls).toHaveLength(2);
    expect(detail?.calls[0]!.outcome).toBe("interested"); // most recent first
  });

  it("returns undefined for an unknown prospect id", async () => {
    const { db, session } = await newAdmin();
    expect(await getSalesProspectDetailAdmin(db, session, "salesprospect_does-not-exist")).toBeUndefined();
  });
});
