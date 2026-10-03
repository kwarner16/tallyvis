/**
 * Sales Call Tracker V1 — prospect-list paste parsing (see
 * docs/decisions/0041-sales-call-tracker.md's "Import format" section).
 * Pure, no database access, so it's trivially unit-testable in isolation
 * from `services/salesProspects.ts`'s duplicate-detection/persistence
 * layer, which calls this first. The actual tokenizing (delimiter
 * detection, Markdown-table tolerance, header aliasing) lives in the
 * shared `tabularImportParsing.ts` — this file only adds this domain's
 * own field list and "what counts as a usable row" validation.
 *
 * Preferred columns: Business Name | Owner | Phone | Email | Website |
 * City | State | Source. Works with however ChatGPT/a spreadsheet
 * actually produces a paste — a Markdown table (`|`-delimited, often
 * with a `---|---` separator row and `**bold**` headers), a
 * spreadsheet's native tab-separated paste, or plain comma-separated
 * text — and tolerates a missing/reordered header by falling back to the
 * documented column order.
 */

import { parseTabularImport, type TabularImportConfig } from "./tabularImportParsing";

export type ParsedProspectField = "businessName" | "contactName" | "phone" | "email" | "website" | "city" | "state" | "source";

export interface ParsedProspectRow {
  lineNumber: number;
  raw: string;
  businessName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
  source?: string;
  /** Empty for a usable row. A row with any error is never imported — see services/salesProspects.ts's preview classification. */
  errors: string[];
}

const IMPORT_CONFIG: TabularImportConfig<ParsedProspectField> = {
  defaultColumnOrder: ["businessName", "contactName", "phone", "email", "website", "city", "state", "source"],
  headerAliases: {
    "business name": "businessName",
    business: "businessName",
    company: "businessName",
    "company name": "businessName",
    name: "businessName",
    owner: "contactName",
    contact: "contactName",
    "contact name": "contactName",
    "owner/contact": "contactName",
    "owner name": "contactName",
    phone: "phone",
    "phone number": "phone",
    telephone: "phone",
    email: "email",
    "email address": "email",
    website: "website",
    site: "website",
    url: "website",
    city: "city",
    state: "state",
    province: "state",
    source: "source",
  },
};

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseProspectImportText(raw: string): ParsedProspectRow[] {
  return parseTabularImport(raw, IMPORT_CONFIG).map(({ lineNumber, raw: rawLine, fields }) => {
    const businessName = emptyToUndefined(fields.businessName) ?? "";
    const phone = emptyToUndefined(fields.phone);

    const errors: string[] = [];
    if (!businessName) errors.push("Missing business name.");
    if (!phone) errors.push("Missing phone number.");

    return {
      lineNumber,
      raw: rawLine,
      businessName,
      contactName: emptyToUndefined(fields.contactName),
      phone,
      email: emptyToUndefined(fields.email),
      website: emptyToUndefined(fields.website),
      city: emptyToUndefined(fields.city),
      state: emptyToUndefined(fields.state),
      source: emptyToUndefined(fields.source),
      errors,
    };
  });
}
