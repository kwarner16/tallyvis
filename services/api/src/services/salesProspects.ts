import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isAdminSession } from "./auth";
import { normalizePhoneNumber } from "./business";
import * as prospectsRepo from "../repositories/salesProspects";
import type { SalesProspect, SalesQueueRow, UpdateSalesProspectInput } from "../repositories/salesProspects";
import * as callsRepo from "../repositories/salesCalls";
import type { SalesCall } from "../repositories/salesCalls";
import { parseProspectImportText } from "./salesImportParsing";

export type { SalesProspect, SalesQueueRow } from "../repositories/salesProspects";
export type { SalesCall } from "../repositories/salesCalls";

/**
 * Sales Call Tracker V1 — prospect CRUD, the calling queue, and bulk
 * import (see docs/decisions/0041-sales-call-tracker.md). Internal
 * admin-only; every exported function independently re-checks admin
 * access, the same defense-in-depth `services/admin.ts`/
 * `services/creators.ts` already establish — never trusted from page-
 * level gating alone.
 */

/**
 * A thin wrapper around the shared `normalizePhoneNumber`
 * (services/business.ts, also relied on for SMS sending) that strips
 * internal whitespace before delegating. That shared function's `+`-
 * prefixed fast path requires an already whitespace-free E.164 string —
 * reasonable for the SMS numbers it normally sees, but this feature's
 * own spec explicitly calls out a human-typed "+1 352 555 1234" as a
 * format that must normalize correctly for duplicate detection.
 * Deliberately never changes `services/business.ts` itself, which SMS
 * sending also depends on, for a tolerance only prospect import needs.
 */
function normalizeSalesPhoneNumber(input: string): string | undefined {
  return normalizePhoneNumber(input.replace(/\s+/g, "")) ?? undefined;
}

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

const NAME_MAX_LENGTH = 200;
const TEXT_FIELD_MAX_LENGTH = 500;

function clean(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export async function getSalesProspectById(db: Queryable, session: AuthSession, id: string): Promise<SalesProspect | undefined> {
  await requireAdmin(db, session);
  return prospectsRepo.getSalesProspectById(db, id);
}

export interface SalesProspectDetail {
  prospect: SalesProspect;
  calls: SalesCall[];
}

export async function getSalesProspectDetailAdmin(db: Queryable, session: AuthSession, id: string): Promise<SalesProspectDetail | undefined> {
  await requireAdmin(db, session);
  const prospect = await prospectsRepo.getSalesProspectById(db, id);
  if (!prospect) return undefined;
  const calls = await callsRepo.listSalesCallsByProspectId(db, id);
  return { prospect, calls };
}

export interface UpdateSalesProspectAdminInput {
  businessName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
}

/** Lets Kyle fix contact info an import got wrong (brief's own requirement — "I should also be able to correct/edit prospect contact information"). Re-normalizes the phone whenever it changes, so a corrected number still participates correctly in future duplicate detection. */
export async function updateSalesProspectAdmin(
  db: Queryable,
  session: AuthSession,
  id: string,
  input: UpdateSalesProspectAdminInput,
): Promise<SalesProspect> {
  await requireAdmin(db, session);

  if (input.businessName !== undefined && !clean(input.businessName, NAME_MAX_LENGTH)) {
    throw new Error("Business name is required.");
  }

  const repoInput: UpdateSalesProspectInput = {
    businessName: input.businessName !== undefined ? clean(input.businessName, NAME_MAX_LENGTH) : undefined,
    contactName: input.contactName !== undefined ? (clean(input.contactName, NAME_MAX_LENGTH) ?? null) : undefined,
    email: input.email !== undefined ? (clean(input.email, TEXT_FIELD_MAX_LENGTH) ?? null) : undefined,
    website: input.website !== undefined ? (clean(input.website, TEXT_FIELD_MAX_LENGTH) ?? null) : undefined,
    city: input.city !== undefined ? (clean(input.city, NAME_MAX_LENGTH) ?? null) : undefined,
    state: input.state !== undefined ? (clean(input.state, NAME_MAX_LENGTH) ?? null) : undefined,
  };

  if (input.phone !== undefined) {
    const trimmedPhone = clean(input.phone, TEXT_FIELD_MAX_LENGTH);
    if (!trimmedPhone) throw new Error("Phone number is required.");
    repoInput.phone = trimmedPhone;
    repoInput.normalizedPhone = normalizeSalesPhoneNumber(trimmedPhone) ?? null;
  }

  const updated = await prospectsRepo.updateSalesProspect(db, id, repoInput);
  if (!updated) throw new Error(`Prospect "${id}" not found.`);
  return updated;
}

/**
 * The calling queue, ordered so "the next appropriate prospect" is
 * always at the top: a due/overdue follow-up outranks a cold,
 * never-contacted prospect, which in turn outranks one with no pending
 * follow-up (already worked, nothing left to do right now). See the
 * ADR's "Call lifecycle" section for why this ordering — not an
 * auto-advance after Save & Next — is what makes "immediately advance to
 * the next appropriate prospect" true without a confusing auto-dial.
 */
export interface SalesQueueEntry {
  prospect: SalesProspect;
  lastCallAt?: string;
  lastOutcome?: string;
  lastNotes?: string;
  followUpAt?: string;
  followUpDue: boolean;
}

export async function listProspectQueueAdmin(db: Queryable, session: AuthSession): Promise<SalesQueueEntry[]> {
  await requireAdmin(db, session);
  const rows = await prospectsRepo.listSalesQueueRows(db);
  const now = new Date().toISOString();

  const entries: SalesQueueEntry[] = rows.map((row: SalesQueueRow) => ({
    ...row,
    followUpDue: Boolean(row.followUpAt && row.followUpAt <= now),
  }));

  return entries.sort((a, b) => {
    const rank = (entry: SalesQueueEntry) => (entry.followUpDue ? 0 : !entry.lastCallAt ? 1 : 2);
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.followUpDue && b.followUpDue) return (a.followUpAt ?? "").localeCompare(b.followUpAt ?? "");
    return a.prospect.createdAt.localeCompare(b.prospect.createdAt);
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ProspectImportRowStatus = "new" | "duplicate" | "possible_duplicate" | "invalid";

export interface ClassifiedProspectImportRow {
  lineNumber: number;
  raw: string;
  businessName: string;
  contactName?: string;
  phone?: string;
  normalizedPhone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
  source?: string;
  status: ProspectImportRowStatus;
  errors: string[];
  /** Populated for "duplicate" — the exact existing prospect this row's phone already matches. */
  existingProspect?: SalesProspect;
  existingLastCall?: { startedAt: string; outcome?: string; notes?: string };
}

export interface ProspectImportClassification {
  rows: ClassifiedProspectImportRow[];
  counts: Record<ProspectImportRowStatus, number>;
}

/**
 * Parses, normalizes, and classifies every row — shared by the preview
 * (read-only) and the actual commit, so the commit NEVER trusts anything
 * the browser says about which rows are "new"; it always re-derives
 * classification itself from the raw text one more time
 * (`commitProspectImportAdmin` below), satisfying "validate imported
 * data server-side even if it was previewed client-side."
 */
async function classifyProspectImport(db: Queryable, rawText: string): Promise<ProspectImportClassification> {
  const parsed = parseProspectImportText(rawText);

  const withNormalized = parsed.map((row) => ({
    ...row,
    normalizedPhone: row.phone ? normalizeSalesPhoneNumber(row.phone) : undefined,
  }));

  const candidatePhones = withNormalized
    .map((row) => row.normalizedPhone)
    .filter((phone): phone is string => Boolean(phone));
  const existingByPhone = await prospectsRepo.findSalesProspectsByNormalizedPhones(db, candidatePhones);
  const existingByPhoneMap = new Map(existingByPhone.map((p) => [p.normalizedPhone!, p]));

  const candidateNames = withNormalized.map((row) => row.businessName).filter((name) => name.length > 0);
  const existingByName = await prospectsRepo.findSalesProspectsByBusinessNames(db, candidateNames);
  const existingByNameMap = new Map(existingByName.map((p) => [p.businessName.toLowerCase(), p]));

  const seenPhonesInBatch = new Set<string>();
  const rows: ClassifiedProspectImportRow[] = [];
  const counts: Record<ProspectImportRowStatus, number> = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0 };

  for (const row of withNormalized) {
    if (row.errors.length > 0 || !row.normalizedPhone) {
      const errors = row.errors.length > 0 ? row.errors : ["Phone number could not be recognized."];
      rows.push({ ...row, status: "invalid", errors });
      counts.invalid += 1;
      continue;
    }

    const existingPhoneMatch = existingByPhoneMap.get(row.normalizedPhone);
    if (existingPhoneMatch || seenPhonesInBatch.has(row.normalizedPhone)) {
      let existingLastCall: ClassifiedProspectImportRow["existingLastCall"];
      if (existingPhoneMatch) {
        const calls = await callsRepo.listSalesCallsByProspectId(db, existingPhoneMatch.id);
        const last = calls[0];
        if (last) existingLastCall = { startedAt: last.startedAt, outcome: last.outcome, notes: last.notes };
      }
      rows.push({ ...row, status: "duplicate", existingProspect: existingPhoneMatch, existingLastCall });
      counts.duplicate += 1;
      continue;
    }

    const nameMatch = existingByNameMap.get(row.businessName.toLowerCase());
    if (nameMatch) {
      rows.push({ ...row, status: "possible_duplicate", existingProspect: nameMatch });
      counts.possible_duplicate += 1;
      seenPhonesInBatch.add(row.normalizedPhone);
      continue;
    }

    seenPhonesInBatch.add(row.normalizedPhone);
    rows.push({ ...row, status: "new" });
    counts.new += 1;
  }

  return { rows, counts };
}

export async function previewProspectImportAdmin(db: Queryable, session: AuthSession, rawText: string): Promise<ProspectImportClassification> {
  await requireAdmin(db, session);
  return classifyProspectImport(db, rawText);
}

export interface ProspectImportResult extends ProspectImportClassification {
  createdCount: number;
}

/**
 * Re-parses and re-classifies the SAME raw text one more time (never the
 * preview's own output) before writing anything — see
 * `classifyProspectImport`'s own comment. Only rows classified "new" are
 * ever inserted; everything else (duplicate/possible_duplicate/invalid)
 * is reported but never written, so re-importing the identical list
 * twice creates zero new rows the second time.
 */
export async function commitProspectImportAdmin(db: Queryable, session: AuthSession, rawText: string): Promise<ProspectImportResult> {
  await requireAdmin(db, session);
  const classification = await classifyProspectImport(db, rawText);

  let createdCount = 0;
  for (const row of classification.rows) {
    if (row.status !== "new") continue;
    await prospectsRepo.createSalesProspect(db, {
      businessName: row.businessName,
      contactName: row.contactName,
      phone: row.phone!,
      normalizedPhone: row.normalizedPhone,
      email: row.email,
      website: row.website,
      city: row.city,
      state: row.state,
      source: row.source,
    });
    createdCount += 1;
  }

  return { ...classification, createdCount };
}
