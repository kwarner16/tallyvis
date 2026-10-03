import { describe, expect, it } from "vitest";
import { parseProspectImportText } from "../services/salesImportParsing";

describe("parseProspectImportText", () => {
  it("parses a pipe-delimited list with a recognized header row", () => {
    const text = `Business Name | Owner | Phone | Email | Website | City | State | Source
Amazing View Window Cleaning | Dana | (352) 555-1234 | dana@example.com | amazingview.com | Ocala | FL | ChatGPT
Crystal Clear Windows | Sam | 352-555-9999 | | | Gainesville | FL | ChatGPT`;

    const rows = parseProspectImportText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      businessName: "Amazing View Window Cleaning",
      contactName: "Dana",
      phone: "(352) 555-1234",
      email: "dana@example.com",
      website: "amazingview.com",
      city: "Ocala",
      state: "FL",
      source: "ChatGPT",
      errors: [],
    });
    expect(rows[1]).toMatchObject({
      businessName: "Crystal Clear Windows",
      phone: "352-555-9999",
      email: undefined,
      website: undefined,
      errors: [],
    });
  });

  it("skips a Markdown table separator row (---|---|---)", () => {
    const text = `Business Name | Phone
---|---
Amazing View Window Cleaning | 352-555-1234`;
    const rows = parseProspectImportText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.businessName).toBe("Amazing View Window Cleaning");
  });

  it("strips Markdown bold markers from header and data cells", () => {
    const text = `**Business Name** | **Phone**
**Amazing View** | **352-555-1234**`;
    const rows = parseProspectImportText(text);
    expect(rows[0]!.businessName).toBe("Amazing View");
    expect(rows[0]!.phone).toBe("352-555-1234");
  });

  it("handles a tab-separated spreadsheet paste (no header, positional fallback)", () => {
    const rows = parseProspectImportText("Amazing View Window Cleaning\tDana\t(352) 555-1234");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessName: "Amazing View Window Cleaning", contactName: "Dana", phone: "(352) 555-1234" });
  });

  it("handles a comma-separated paste", () => {
    const rows = parseProspectImportText("Amazing View Window Cleaning,Dana,352-555-1234");
    expect(rows[0]).toMatchObject({ businessName: "Amazing View Window Cleaning", contactName: "Dana", phone: "352-555-1234" });
  });

  it("falls back to the documented column order when no recognizable header is present", () => {
    const rows = parseProspectImportText("Amazing View Window Cleaning | Dana | 352-555-1234");
    expect(rows[0]).toMatchObject({ businessName: "Amazing View Window Cleaning", contactName: "Dana", phone: "352-555-1234" });
  });

  it("tolerates a reordered header — columns map by name, not position", () => {
    const text = `Phone | Business Name
352-555-1234 | Amazing View Window Cleaning`;
    const rows = parseProspectImportText(text);
    expect(rows[0]).toMatchObject({ businessName: "Amazing View Window Cleaning", phone: "352-555-1234" });
  });

  it("tolerates a header with only some recognized columns, defaulting the rest to document order", () => {
    const text = `Business Name | Phone | Extra Column
Amazing View | 352-555-1234 | whatever`;
    const rows = parseProspectImportText(text);
    expect(rows[0]!.businessName).toBe("Amazing View");
    expect(rows[0]!.phone).toBe("352-555-1234");
  });

  it("flags a row missing a business name as invalid", () => {
    const rows = parseProspectImportText("Business Name | Phone\n | 352-555-1234");
    expect(rows[0]!.errors).toContain("Missing business name.");
  });

  it("flags a row missing a phone number as invalid", () => {
    const rows = parseProspectImportText("Business Name | Phone\nAmazing View |");
    expect(rows[0]!.errors).toContain("Missing phone number.");
  });

  it("flags a row missing both as invalid with both errors", () => {
    // Comma-delimited here deliberately — an all-pipe/whitespace data row
    // (e.g. "Business Name | Phone\n |") is indistinguishable from a
    // Markdown separator row and is treated as blank/skippable instead.
    const rows = parseProspectImportText("Business Name,Phone\n,");
    expect(rows[0]!.errors).toEqual(["Missing business name.", "Missing phone number."]);
  });

  it("ignores blank lines", () => {
    const text = "Business Name | Phone\n\nAmazing View | 352-555-1234\n\n";
    const rows = parseProspectImportText(text);
    expect(rows).toHaveLength(1);
  });

  it("returns an empty array for empty input", () => {
    expect(parseProspectImportText("")).toEqual([]);
    expect(parseProspectImportText("   \n  \n")).toEqual([]);
  });

  it("records the original 1-indexed line number and raw text for each row, accounting for a skipped header", () => {
    const text = `Business Name | Phone
Amazing View | 352-555-1234
Crystal Clear | 352-555-9999`;
    const rows = parseProspectImportText(text);
    expect(rows[0]!.lineNumber).toBe(2);
    expect(rows[1]!.lineNumber).toBe(3);
    expect(rows[1]!.raw).toContain("Crystal Clear");
  });
});
