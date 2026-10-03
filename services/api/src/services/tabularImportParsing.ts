/**
 * Generic tabular-paste tokenizer, extracted from the Sales Call
 * Tracker's own prospect-list parser (see
 * docs/decisions/0041-sales-call-tracker.md) so the Creator Outreach
 * Tracker (docs/decisions/0042-creator-outreach-tracker.md) reuses the
 * exact same, already-tested delimiter detection / Markdown-table
 * tolerance / header-aliasing behavior rather than a second copy of it.
 * Pure, no database access. Domain-specific field validation (which
 * fields are required, what "usable" means) stays in each feature's own
 * thin wrapper (`salesImportParsing.ts`, `creatorOutreachParsing.ts`) —
 * this file only tokenizes a pasted block of text into labeled cells.
 */

/** A Markdown table's own separator row (`---|---|---`, `:--|--:`, etc.) — never real data. */
const MARKDOWN_SEPARATOR_PATTERN = /^[\s|:-]+$/;

export interface TabularImportConfig<F extends string> {
  /** Lowercased, trimmed header text -> field. Matching is case-insensitive. */
  headerAliases: Record<string, F>;
  /** Used positionally only when no row has ≥2 recognized header cells. */
  defaultColumnOrder: F[];
}

export interface TabularRow<F extends string> {
  lineNumber: number;
  raw: string;
  fields: Partial<Record<F, string>>;
}

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

function detectHeaderMapping<F extends string>(cells: string[], headerAliases: Record<string, F>): (F | undefined)[] | undefined {
  const mapping: (F | undefined)[] = cells.map((cell) => headerAliases[cell.toLowerCase().trim()]);
  const matchCount = mapping.filter((field) => field !== undefined).length;
  // Require at least 2 recognized header cells before trusting this as a header row rather than a real data row that happens to contain, e.g., the literal word "Phone" as a business name.
  if (matchCount < 2) return undefined;
  // An unrecognized header cell (e.g. a stray "Extra Column") is simply
  // ignored, never guessed by falling back to its raw position in
  // defaultColumnOrder — that order only applies when there is NO header
  // at all, and reusing it here would silently misassign data whenever
  // the recognized columns aren't in that exact order.
  return mapping;
}

export function parseTabularImport<F extends string>(raw: string, config: TabularImportConfig<F>): TabularRow<F>[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0 && !MARKDOWN_SEPARATOR_PATTERN.test(line));

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]!.line);
  const firstRowCells = splitRow(lines[0]!.line, delimiter);
  const headerMapping = detectHeaderMapping(firstRowCells, config.headerAliases);
  const dataLines = headerMapping ? lines.slice(1) : lines;
  const columnOrder = headerMapping ?? config.defaultColumnOrder;

  return dataLines.map(({ line, lineNumber }) => {
    const cells = splitRow(line, delimiter);
    const fields: Partial<Record<F, string>> = {};
    cells.forEach((cell, index) => {
      const field = columnOrder[index];
      if (field) fields[field] = cell;
    });
    return { lineNumber, raw: line, fields };
  });
}
