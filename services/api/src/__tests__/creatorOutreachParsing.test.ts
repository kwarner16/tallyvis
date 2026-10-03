import { describe, expect, it } from "vitest";
import { parseCreatorProspectImportText } from "../services/creatorOutreachParsing";

describe("parseCreatorProspectImportText", () => {
  it("parses a pipe-delimited list with a recognized header row", () => {
    const text = `Creator Name | Contact Name | Email | Primary Platform | Profile URL | Other Platforms | Niche | Followers | Source
SteveO The Window Cleaner | Steve | steve@example.com | YouTube | https://youtube.com/@steveo | https://tiktok.com/@steveo | Window Cleaning | 42K | ChatGPT
Crystal Clear Creator | | | TikTok | https://tiktok.com/@crystalclear | | Home Services |  | ChatGPT`;

    const rows = parseCreatorProspectImportText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      displayName: "SteveO The Window Cleaner",
      contactName: "Steve",
      email: "steve@example.com",
      platform: "YouTube",
      profileUrl: "https://youtube.com/@steveo",
      otherProfileUrls: ["https://tiktok.com/@steveo"],
      niche: "Window Cleaning",
      followersApprox: "42K",
      source: "ChatGPT",
      errors: [],
    });
    expect(rows[1]).toMatchObject({
      displayName: "Crystal Clear Creator",
      contactName: undefined,
      email: undefined,
      profileUrl: "https://tiktok.com/@crystalclear",
      errors: [],
    });
  });

  it("splits multiple other-platform URLs on comma/semicolon within one cell", () => {
    const text = `Creator Name | Profile URL | Other Platforms
SteveO | https://youtube.com/@steveo | https://tiktok.com/@steveo, https://instagram.com/steveo`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows[0]!.otherProfileUrls).toEqual(["https://tiktok.com/@steveo", "https://instagram.com/steveo"]);
  });

  it("tolerates a reordered header — columns map by name, not position", () => {
    const text = `Profile URL | Creator Name
https://youtube.com/@steveo | SteveO`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows[0]).toMatchObject({ displayName: "SteveO", profileUrl: "https://youtube.com/@steveo" });
  });

  it("falls back to the documented column order when no recognizable header is present", () => {
    const rows = parseCreatorProspectImportText("SteveO | Steve | steve@example.com");
    expect(rows[0]).toMatchObject({ displayName: "SteveO", contactName: "Steve", email: "steve@example.com" });
  });

  it("flags a row missing a creator name as invalid, even with every other field present", () => {
    const text = `Creator Name | Email
 | steve@example.com`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows[0]!.errors).toContain("Missing creator name.");
  });

  it("does NOT require an email — a row with only a profile URL has no parser-level error", () => {
    const text = `Creator Name | Email | Profile URL
SteveO | | https://youtube.com/@steveo`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.email).toBeUndefined();
  });

  it("does NOT require a profile URL — a row with only an email has no parser-level error", () => {
    const text = `Creator Name | Email | Profile URL
SteveO | steve@example.com |`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.profileUrl).toBeUndefined();
  });

  it("ignores blank lines and a Markdown separator row", () => {
    const text = `Creator Name | Profile URL
---|---

SteveO | https://youtube.com/@steveo

`;
    const rows = parseCreatorProspectImportText(text);
    expect(rows).toHaveLength(1);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCreatorProspectImportText("")).toEqual([]);
  });
});
