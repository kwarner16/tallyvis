import { describe, expect, it } from "vitest";
import { firstNameOf, renderOutreachEmail1, renderOutreachEmail2, OUTREACH_EMAIL_SUBJECT_1 } from "../creatorOutreachTemplates";

describe("firstNameOf", () => {
  it("returns the first token of a real contact name", () => {
    expect(firstNameOf("Steve Smith")).toBe("Steve");
    expect(firstNameOf("  Dana   Lee ")).toBe("Dana");
  });

  it("returns undefined for an absent/empty contact name — never fabricates a first name from anything else", () => {
    expect(firstNameOf(undefined)).toBeUndefined();
    expect(firstNameOf(null)).toBeUndefined();
    expect(firstNameOf("")).toBeUndefined();
    expect(firstNameOf("   ")).toBeUndefined();
  });
});

describe("renderOutreachEmail1", () => {
  it("substitutes a known contact's first name into the greeting", () => {
    const text = renderOutreachEmail1("Steve Smith");
    expect(text.startsWith("Hi Steve,")).toBe(true);
  });

  it("leaves the literal [Name] placeholder when no contact name is known — never fabricates one from a channel/display name", () => {
    const text = renderOutreachEmail1(undefined);
    expect(text.startsWith("Hi [Name],")).toBe(true);
  });

  it("contains the exact 20% recurring commission and $159/$31.80 figures, and never any Markdown bold syntax", () => {
    const text = renderOutreachEmail1("Steve");
    expect(text).toContain("20% RECURRING commission");
    expect(text).toContain("$159/month");
    expect(text).toContain("$31.80/month");
    expect(text).toContain("Kyle Warner");
    expect(text).not.toContain("**");
  });
});

describe("renderOutreachEmail2", () => {
  it("substitutes a known contact's first name into the 'Hey' greeting", () => {
    const text = renderOutreachEmail2("Dana Lee");
    expect(text.startsWith("Hey Dana,")).toBe(true);
  });

  it("leaves the literal [First Name] placeholder when no contact name is known", () => {
    const text = renderOutreachEmail2(undefined);
    expect(text.startsWith("Hey [First Name],")).toBe(true);
  });

  it("preserves every content-specific personalization placeholder intact, regardless of contact name", () => {
    const text = renderOutreachEmail2("Steve");
    expect(text).toContain("[SPECIFIC VIDEO/TOPIC]");
    expect(text).toContain("[1–2 PERSONAL SENTENCES RESPONDING DIRECTLY TO WHAT THEY SAID IN THEIR REPLY.]");
    expect(text).toContain("[PERSONAL TRANSITION");
    expect(text).toContain("[EXACT NEXT STEP]");
  });

  it("uses the corrected 'at least one meaningful piece of TallyVis content per month' wording (not 'piece(s)')", () => {
    const text = renderOutreachEmail2("Steve");
    expect(text).toContain("at least one meaningful piece of TallyVis content per month");
    expect(text).not.toContain("piece(s)");
  });

  it("states the 20% recurring commission for the first 12 months, matching the actual Creator Program terms", () => {
    const text = renderOutreachEmail2("Steve");
    expect(text).toContain("20% of eligible subscription revenue");
    expect(text).toContain("every month, for their first 12 months");
    expect(text).not.toContain("**");
  });
});

describe("OUTREACH_EMAIL_SUBJECT_1", () => {
  it("is the exact subject line used for the mailto: prefill", () => {
    expect(OUTREACH_EMAIL_SUBJECT_1).toBe("A partnership idea for you");
  });
});
