/**
 * Sales Call Tracker V1 — prospect-list paste parsing (see
 * docs/decisions/0041-sales-call-tracker.md's "Import format" section).
 * Pure, no database access, so it's trivially unit-testable in isolation
 * from `services/salesProspects.ts`'s duplicate-detection/persistence
 * layer, which calls this first.
 *
 * Preferred columns: Business Name | Owner | Phone | Email | Website |
 * City | State | Source. Works with however ChatGPT/a spreadsheet
 * actually produces a paste — a Markdown table (`|`-delimited, often
 * with a `---|---` separator row and `**bold**` headers), a
 * spreadsheet's native tab-separated paste, or plain comma-separated
 * text — and tolerates a missing/reordered header by falling back to the
 * documented column order.
 */

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

const DEFAULT_COLUMN_ORDER: ParsedProspectField[] = [
  "businessName",
  "contactName",
  "phone",
  "email",
  "website",
  "city",
  "state",
  "source",
];

const HEADER_ALIASES: Record<string, ParsedProspectField> = {
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
};

/** A Markdown table's own separator row (`---|---|---`, `:--|--:`, etc.) — never real data. */
const MARKDOWN_SEPARATOR_PATTERN = /^[\s|:-]+$/;

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes("|")) return "|";
  return ",";
}

function splitRow(line: string, delimiter: string): string[] {
  let working = line.trim();
  // A full Markdown table row is wrapped on BOTH ends (`| a | b | c |`) —
  // only strip in that exact case. A row with just a LEADING pipe and no
  // trailing one (e.g. an empty first cell: `| 352-555-1234`, no closing
  // pipe) is not decorative wrapping — the leading pipe there IS the
  // delimiter for that empty cell, and stripping it would wrongly merge
  // two cells into one.
  if (delimiter === "|" && working.startsWith("|") && working.endsWith("|") && working.length > 1) {
    working = working.slice(1, -1);
  }
  return working.split(delimiter).map((cell) => cell.trim().replace(/^\*\*/, "").replace(/\*\*$/, "").trim());
}

function detectHeaderMapping(cells: string[]): (ParsedProspectField | undefined)[] | undefined {
  const mapping: (ParsedProspectField | undefined)[] = cells.map((cell) => HEADER_ALIASES[cell.toLowerCase().trim()]);
  const matchCount = mapping.filter((field) => field !== undefined).length;
  // Require at least 2 recognized header cells before trusting this as a header row rather than a real data row that happens to contain, e.g., the literal word "Phone" as a business name.
  if (matchCount < 2) return undefined;
  // An unrecognized header cell (e.g. a stray "Extra Column") is simply
  // ignored, never guessed by falling back to its raw position in
  // DEFAULT_COLUMN_ORDER — that order only applies when there is NO
  // header at all, and reusing it here would silently misassign data
  // whenever the recognized columns aren't in that exact order.
  return mapping;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseProspectImportText(raw: string): ParsedProspectRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0 && !MARKDOWN_SEPARATOR_PATTERN.test(line));

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]!.line);
  const firstRowCells = splitRow(lines[0]!.line, delimiter);
  const headerMapping = detectHeaderMapping(firstRowCells);
  const dataLines = headerMapping ? lines.slice(1) : lines;
  const columnOrder = headerMapping ?? DEFAULT_COLUMN_ORDER;

  return dataLines.map(({ line, lineNumber }) => {
    const cells = splitRow(line, delimiter);
    const fields: Partial<Record<ParsedProspectField, string>> = {};
    cells.forEach((cell, index) => {
      const field = columnOrder[index];
      if (field) fields[field] = cell;
    });

    const businessName = emptyToUndefined(fields.businessName) ?? "";
    const phone = emptyToUndefined(fields.phone);

    const errors: string[] = [];
    if (!businessName) errors.push("Missing business name.");
    if (!phone) errors.push("Missing phone number.");

    return {
      lineNumber,
      raw: line,
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
