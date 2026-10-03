/**
 * Founding Creator Outreach Tracker V1 — creator-prospect-list paste
 * parsing (see docs/decisions/0042-creator-outreach-tracker.md's
 * "Import format" section). Pure, no database access — mirrors
 * `salesImportParsing.ts`'s shape exactly, reusing the same shared
 * tokenizer (`tabularImportParsing.ts`) rather than a second copy of
 * the delimiter/Markdown/header-aliasing logic.
 *
 * Preferred columns: Creator Name | Contact Name | Email | Primary
 * Platform | Profile URL | Other Platforms | Niche | Followers |
 * Source.
 *
 * Deliberately does NOT validate email format or URL safety here — that
 * needs no database access either, but conceptually belongs alongside
 * the rest of this domain's normalization in
 * `services/creatorProspects.ts` (the exact same split
 * `salesImportParsing.ts`/`services/salesProspects.ts` already use for
 * phone normalization). This file only tokenizes and checks for the one
 * thing no later layer could recover from: a missing creator name.
 */

import { parseTabularImport, type TabularImportConfig } from "./tabularImportParsing";

export type ParsedCreatorProspectField =
  | "displayName"
  | "contactName"
  | "email"
  | "platform"
  | "profileUrl"
  | "otherProfileUrls"
  | "niche"
  | "followersApprox"
  | "source";

export interface ParsedCreatorProspectRow {
  lineNumber: number;
  raw: string;
  displayName: string;
  contactName?: string;
  email?: string;
  platform?: string;
  profileUrl?: string;
  /** Split on comma/semicolon within the cell — a cell can list more than one additional URL. */
  otherProfileUrls: string[];
  niche?: string;
  /** Raw text as pasted (e.g. "12K", "450000") — services/creatorProspects.ts parses this to a number, tolerating a "k"/"m" suffix. */
  followersApprox?: string;
  source?: string;
  errors: string[];
}

const IMPORT_CONFIG: TabularImportConfig<ParsedCreatorProspectField> = {
  defaultColumnOrder: ["displayName", "contactName", "email", "platform", "profileUrl", "otherProfileUrls", "niche", "followersApprox", "source"],
  headerAliases: {
    "creator name": "displayName",
    creator: "displayName",
    channel: "displayName",
    name: "displayName",
    "display name": "displayName",
    "contact name": "contactName",
    contact: "contactName",
    "real name": "contactName",
    email: "email",
    "email address": "email",
    "primary platform": "platform",
    platform: "platform",
    "profile url": "profileUrl",
    "channel url": "profileUrl",
    url: "profileUrl",
    link: "profileUrl",
    "other platforms": "otherProfileUrls",
    "other urls": "otherProfileUrls",
    "other social": "otherProfileUrls",
    "other profiles": "otherProfileUrls",
    niche: "niche",
    category: "niche",
    followers: "followersApprox",
    subscribers: "followersApprox",
    audience: "followersApprox",
    source: "source",
  },
};

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function splitOtherUrls(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function parseCreatorProspectImportText(raw: string): ParsedCreatorProspectRow[] {
  return parseTabularImport(raw, IMPORT_CONFIG).map(({ lineNumber, raw: rawLine, fields }) => {
    const displayName = emptyToUndefined(fields.displayName) ?? "";
    const errors: string[] = [];
    if (!displayName) errors.push("Missing creator name.");

    return {
      lineNumber,
      raw: rawLine,
      displayName,
      contactName: emptyToUndefined(fields.contactName),
      email: emptyToUndefined(fields.email),
      platform: emptyToUndefined(fields.platform),
      profileUrl: emptyToUndefined(fields.profileUrl),
      otherProfileUrls: splitOtherUrls(fields.otherProfileUrls),
      niche: emptyToUndefined(fields.niche),
      followersApprox: emptyToUndefined(fields.followersApprox),
      source: emptyToUndefined(fields.source),
      errors,
    };
  });
}
