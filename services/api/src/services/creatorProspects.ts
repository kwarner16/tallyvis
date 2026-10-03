import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isAdminSession } from "./auth";
import { createCreatorAdmin, type CreateCreatorInput, type Creator } from "./creators";
import * as prospectsRepo from "../repositories/creatorProspects";
import type { CreatorProspect, CreatorOutreachQueueRow } from "../repositories/creatorProspects";
import * as activitiesRepo from "../repositories/creatorOutreachActivities";
import { parseCreatorProspectImportText } from "./creatorOutreachParsing";

export type { CreatorProspect, CreatorOutreachQueueRow } from "../repositories/creatorProspects";

/**
 * Founding Creator Outreach Tracker V1 (internal admin tool — see
 * docs/decisions/0042-creator-outreach-tracker.md). Internal
 * admin-only; every exported function independently re-checks admin
 * access, the same defense-in-depth every other admin service in this
 * codebase already establishes.
 */

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

const NAME_MAX_LENGTH = 200;
const TEXT_FIELD_MAX_LENGTH = 500;
const NOTES_MAX_LENGTH = 4000;
const EMAIL_PATTERN = /\S+@\S+\.\S+/;

export function normalizeEmail(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  return EMAIL_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** http(s)-only — never `javascript:`/`data:`/any other scheme. The one gate every stored profile URL must pass before it's ever rendered as a clickable link. */
export function isSafeHttpUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A small, bounded set of platform "tab" suffixes (YouTube's /videos, /featured, /about, /shorts; TikTok/Instagram have none of their own but sharing the list costs nothing) stripped so obviously-the-same channel URLs collapse to one canonical form. Never a scraper or platform API call — just a documented string heuristic. Returns undefined for anything that isn't a safe http(s) URL. */
export function normalizeProfileUrl(input: string): string | undefined {
  if (!isSafeHttpUrl(input)) return undefined;
  const url = new URL(input.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const KNOWN_TRAILING_SEGMENTS = new Set(["videos", "featured", "about", "shorts", "posts", "streams"]);
  const segments = url.pathname.split("/").filter(Boolean);
  while (segments.length > 1 && KNOWN_TRAILING_SEGMENTS.has(segments[segments.length - 1]!.toLowerCase())) {
    segments.pop();
  }
  const path = segments.length > 0 ? `/${segments.join("/")}` : "";
  return `${host}${path}`.toLowerCase();
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function parseFollowersApprox(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  const match = /^([\d.]+)\s*([km]?)$/.exec(trimmed);
  if (!match) return undefined;
  const base = Number.parseFloat(match[1]!);
  if (!Number.isFinite(base)) return undefined;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  return Math.round(base * multiplier);
}

// ---------------------------------------------------------------------------
// Prospect CRUD / detail / queue
// ---------------------------------------------------------------------------

export async function getCreatorProspectById(db: Queryable, session: AuthSession, id: string): Promise<CreatorProspect | undefined> {
  await requireAdmin(db, session);
  return prospectsRepo.getCreatorProspectById(db, id);
}

export interface CreatorProspectDetail {
  prospect: CreatorProspect;
  activities: activitiesRepo.CreatorOutreachActivity[];
}

export async function getCreatorProspectDetailAdmin(db: Queryable, session: AuthSession, id: string): Promise<CreatorProspectDetail | undefined> {
  await requireAdmin(db, session);
  const prospect = await prospectsRepo.getCreatorProspectById(db, id);
  if (!prospect) return undefined;
  const activities = await activitiesRepo.listCreatorOutreachActivitiesByProspectId(db, id);
  return { prospect, activities };
}

export interface UpdateCreatorProspectAdminInput {
  displayName?: string;
  contactName?: string;
  contactEmail?: string;
  platform?: string;
  profileUrl?: string;
  otherProfileUrls?: string[];
  niche?: string;
  followersApprox?: string;
  notes?: string;
}

/** Lets Kyle correct info an import got wrong. Re-normalizes email/profile URL whenever they change, and rejects an unsafe URL scheme outright rather than silently dropping it — the brief's own "validate/sanitize stored URLs" requirement. */
export async function updateCreatorProspectAdmin(
  db: Queryable,
  session: AuthSession,
  id: string,
  input: UpdateCreatorProspectAdminInput,
): Promise<CreatorProspect> {
  await requireAdmin(db, session);

  if (input.displayName !== undefined && !clean(input.displayName, NAME_MAX_LENGTH)) {
    throw new Error("Creator name is required.");
  }

  const repoInput: prospectsRepo.UpdateCreatorProspectInput = {
    displayName: input.displayName !== undefined ? clean(input.displayName, NAME_MAX_LENGTH) : undefined,
    contactName: input.contactName !== undefined ? (clean(input.contactName, NAME_MAX_LENGTH) ?? null) : undefined,
    niche: input.niche !== undefined ? (clean(input.niche, NAME_MAX_LENGTH) ?? null) : undefined,
    platform: input.platform !== undefined ? (clean(input.platform, NAME_MAX_LENGTH) ?? "") : undefined,
    notes: input.notes !== undefined ? clean(input.notes, NOTES_MAX_LENGTH) ?? "" : undefined,
  };

  if (input.contactEmail !== undefined) {
    const trimmedEmail = clean(input.contactEmail, TEXT_FIELD_MAX_LENGTH);
    if (trimmedEmail) {
      const normalized = normalizeEmail(trimmedEmail);
      if (!normalized) throw new Error("Please enter a valid email address.");
      repoInput.contactEmail = trimmedEmail;
      repoInput.normalizedEmail = normalized;
    } else {
      repoInput.contactEmail = null;
      repoInput.normalizedEmail = null;
    }
  }

  if (input.profileUrl !== undefined) {
    const trimmedUrl = clean(input.profileUrl, TEXT_FIELD_MAX_LENGTH);
    if (trimmedUrl) {
      const normalized = normalizeProfileUrl(trimmedUrl);
      if (!normalized) throw new Error("Please enter a valid http(s) profile URL.");
      repoInput.profileUrl = trimmedUrl;
      repoInput.normalizedProfileUrl = normalized;
    } else {
      repoInput.profileUrl = null;
      repoInput.normalizedProfileUrl = null;
    }
  }

  if (input.otherProfileUrls !== undefined) {
    repoInput.otherProfileUrls = input.otherProfileUrls.map((url) => url.trim()).filter((url) => isSafeHttpUrl(url));
  }

  if (input.followersApprox !== undefined) {
    repoInput.followersApprox = input.followersApprox.trim() ? parseFollowersApprox(input.followersApprox) ?? null : null;
  }

  const updated = await prospectsRepo.updateCreatorProspect(db, id, repoInput);
  if (!updated) throw new Error(`Creator prospect "${id}" not found.`);
  return updated;
}

/**
 * The outreach queue, ordered so a due/overdue follow-up always outranks
 * a never-contacted prospect, which outranks one already worked with no
 * pending follow-up — identical reasoning to the Sales Call Tracker's
 * `listProspectQueueAdmin`. A converted prospect is excluded entirely —
 * nothing left to do with it here; see it on the real creator's own
 * `/admin/creators/[id]` page instead.
 */
export interface CreatorOutreachQueueEntry {
  prospect: CreatorProspect;
  lastActivityNotes?: string;
  followUpDue: boolean;
}

export async function listCreatorOutreachQueueAdmin(db: Queryable, session: AuthSession): Promise<CreatorOutreachQueueEntry[]> {
  await requireAdmin(db, session);
  const rows = await prospectsRepo.listCreatorOutreachQueueRows(db);
  const now = new Date().toISOString();

  const entries: CreatorOutreachQueueEntry[] = rows
    .filter((row: CreatorOutreachQueueRow) => row.prospect.status !== "converted")
    .map((row) => ({
      ...row,
      followUpDue: Boolean(row.prospect.followUpAt && row.prospect.followUpAt <= now),
    }));

  return entries.sort((a, b) => {
    const rank = (entry: CreatorOutreachQueueEntry) =>
      entry.followUpDue ? 0 : entry.prospect.status === "not_contacted" ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.followUpDue && b.followUpDue) return (a.prospect.followUpAt ?? "").localeCompare(b.prospect.followUpAt ?? "");
    return a.prospect.createdAt.localeCompare(b.prospect.createdAt);
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type CreatorProspectImportRowStatus = "new" | "duplicate" | "possible_duplicate" | "invalid";

export interface ClassifiedCreatorProspectImportRow {
  lineNumber: number;
  raw: string;
  displayName: string;
  contactName?: string;
  email?: string;
  normalizedEmail?: string;
  platform?: string;
  profileUrl?: string;
  normalizedProfileUrl?: string;
  otherProfileUrls: string[];
  niche?: string;
  followersApprox?: number;
  source?: string;
  status: CreatorProspectImportRowStatus;
  errors: string[];
  existingProspect?: CreatorProspect;
}

export interface CreatorProspectImportClassification {
  rows: ClassifiedCreatorProspectImportRow[];
  counts: Record<CreatorProspectImportRowStatus, number>;
}

/**
 * Parses, normalizes, and classifies every row — shared by the
 * read-only preview and the actual commit, so the commit NEVER trusts
 * anything the browser displayed; it always re-derives classification
 * from the raw text itself (`commitCreatorProspectImportAdmin` below).
 * Mirrors `services/salesProspects.ts`'s `classifyProspectImport`
 * exactly, with TWO primary duplicate signals here (email OR profile
 * URL) instead of one.
 */
async function classifyCreatorProspectImport(db: Queryable, rawText: string): Promise<CreatorProspectImportClassification> {
  const parsed = parseCreatorProspectImportText(rawText);

  const withNormalized = parsed.map((row) => ({
    ...row,
    normalizedEmail: row.email ? normalizeEmail(row.email) : undefined,
    normalizedProfileUrl: row.profileUrl ? normalizeProfileUrl(row.profileUrl) : undefined,
    followersApproxValue: parseFollowersApprox(row.followersApprox),
  }));

  const candidateEmails = withNormalized.map((row) => row.normalizedEmail).filter((e): e is string => Boolean(e));
  const existingByEmail = await prospectsRepo.findCreatorProspectsByNormalizedEmails(db, candidateEmails);
  const existingByEmailMap = new Map(existingByEmail.map((p) => [p.normalizedEmail!, p]));

  const candidateUrls = withNormalized.map((row) => row.normalizedProfileUrl).filter((u): u is string => Boolean(u));
  const existingByUrl = await prospectsRepo.findCreatorProspectsByNormalizedProfileUrls(db, candidateUrls);
  const existingByUrlMap = new Map(existingByUrl.map((p) => [p.normalizedProfileUrl!, p]));

  const candidateNames = withNormalized.map((row) => row.displayName).filter((n) => n.length > 0);
  const existingByName = await prospectsRepo.findCreatorProspectsByDisplayNames(db, candidateNames);
  const existingByNameMap = new Map(existingByName.map((p) => [p.displayName.toLowerCase(), p]));

  const seenEmailsInBatch = new Set<string>();
  const seenUrlsInBatch = new Set<string>();
  const rows: ClassifiedCreatorProspectImportRow[] = [];
  const counts: Record<CreatorProspectImportRowStatus, number> = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0 };

  for (const row of withNormalized) {
    const base = {
      lineNumber: row.lineNumber,
      raw: row.raw,
      displayName: row.displayName,
      contactName: row.contactName,
      email: row.email,
      normalizedEmail: row.normalizedEmail,
      platform: row.platform,
      // Only ever carried through when it ALSO passed the http(s)-only
      // safety check (normalizedProfileUrl is set) — a row that has an
      // email AND an unsafe-scheme "profile URL" is still importable
      // (email alone satisfies the minimum bar), but the unsafe URL
      // itself must never reach storage, even then.
      profileUrl: row.normalizedProfileUrl ? row.profileUrl : undefined,
      normalizedProfileUrl: row.normalizedProfileUrl,
      // Same safety gate as the primary profile URL — any entry with an
      // unsafe scheme is silently dropped rather than stored.
      otherProfileUrls: row.otherProfileUrls.filter((url) => isSafeHttpUrl(url)),
      niche: row.niche,
      followersApprox: row.followersApproxValue,
      source: row.source,
    };

    // A row needs a creator name AND at least one of (a safely-normalized
    // email, a safely-normalized profile URL) to be usable — the exact
    // "no publicly verified email is fine if we have a usable profile
    // URL" minimum bar from the brief, applied symmetrically.
    const hasUsableContact = Boolean(row.normalizedEmail || row.normalizedProfileUrl);
    if (row.errors.length > 0 || !hasUsableContact) {
      const errors = [...row.errors];
      if (hasUsableContact === false) {
        if (row.email && !row.normalizedEmail) errors.push("Email address could not be recognized.");
        if (row.profileUrl && !row.normalizedProfileUrl) errors.push("Profile URL must be a valid http(s) link.");
        if (!row.email && !row.profileUrl) errors.push("Needs an email address or a profile URL.");
      }
      rows.push({ ...base, status: "invalid", errors });
      counts.invalid += 1;
      continue;
    }

    const existingEmailMatch = row.normalizedEmail ? existingByEmailMap.get(row.normalizedEmail) : undefined;
    const existingUrlMatch = row.normalizedProfileUrl ? existingByUrlMap.get(row.normalizedProfileUrl) : undefined;
    const existing = existingEmailMatch ?? existingUrlMatch;
    const seenInBatch =
      (row.normalizedEmail && seenEmailsInBatch.has(row.normalizedEmail)) ||
      (row.normalizedProfileUrl && seenUrlsInBatch.has(row.normalizedProfileUrl));

    if (existing || seenInBatch) {
      rows.push({ ...base, status: "duplicate", errors: [], existingProspect: existing });
      counts.duplicate += 1;
      continue;
    }

    const nameMatch = existingByNameMap.get(row.displayName.toLowerCase());
    if (nameMatch) {
      rows.push({ ...base, status: "possible_duplicate", errors: [], existingProspect: nameMatch });
      counts.possible_duplicate += 1;
      if (row.normalizedEmail) seenEmailsInBatch.add(row.normalizedEmail);
      if (row.normalizedProfileUrl) seenUrlsInBatch.add(row.normalizedProfileUrl);
      continue;
    }

    if (row.normalizedEmail) seenEmailsInBatch.add(row.normalizedEmail);
    if (row.normalizedProfileUrl) seenUrlsInBatch.add(row.normalizedProfileUrl);
    rows.push({ ...base, status: "new", errors: [] });
    counts.new += 1;
  }

  return { rows, counts };
}

export async function previewCreatorProspectImportAdmin(db: Queryable, session: AuthSession, rawText: string): Promise<CreatorProspectImportClassification> {
  await requireAdmin(db, session);
  return classifyCreatorProspectImport(db, rawText);
}

export interface CreatorProspectImportResult extends CreatorProspectImportClassification {
  createdCount: number;
}

export async function commitCreatorProspectImportAdmin(db: Queryable, session: AuthSession, rawText: string): Promise<CreatorProspectImportResult> {
  await requireAdmin(db, session);
  const classification = await classifyCreatorProspectImport(db, rawText);

  let createdCount = 0;
  for (const row of classification.rows) {
    if (row.status !== "new") continue;
    await prospectsRepo.createCreatorProspect(db, {
      displayName: row.displayName,
      contactName: row.contactName,
      contactEmail: row.email,
      normalizedEmail: row.normalizedEmail,
      platform: row.platform,
      profileUrl: row.profileUrl,
      normalizedProfileUrl: row.normalizedProfileUrl,
      otherProfileUrls: row.otherProfileUrls,
      niche: row.niche,
      followersApprox: row.followersApprox,
      source: row.source,
    });
    createdCount += 1;
  }

  return { ...classification, createdCount };
}

// ---------------------------------------------------------------------------
// Conversion to a real Founding Creator
// ---------------------------------------------------------------------------

export interface ConvertCreatorProspectInput {
  slug: string;
  name?: string;
  email: string;
  platform?: string;
  profileUrl?: string;
  notes?: string;
}

/**
 * The one safe, explicit link from a creator PROSPECT to a real
 * `creators` row — reuses `createCreatorAdmin` entirely unchanged
 * rather than re-implementing creator creation (the brief's own
 * explicit instruction). Deliberately does NOT pass `status: "active"`
 * — the new creator is created in `createCreatorAdmin`'s own default
 * ("prospect") status, so activation, complimentary access, business
 * linking, and everything else about the Founding Creator Program
 * continues through its existing, unchanged admin workflow
 * (`/admin/creators/[id]`). Nothing about replying positively to an
 * outreach email implies any of that.
 *
 * Wrapped in a single transaction with the conditional
 * `markCreatorProspectConverted` update: if a concurrent double-submit
 * loses the race (the prospect was already converted by another
 * request), the whole transaction — INCLUDING the just-created creator
 * row — rolls back, so a lost race can never leave an orphaned,
 * unlinked creator behind.
 */
export async function convertProspectToCreatorAdmin(
  db: Queryable,
  session: AuthSession,
  prospectId: string,
  input: ConvertCreatorProspectInput,
): Promise<Creator> {
  await requireAdmin(db, session);

  return db.transaction(async (tx) => {
    const prospect = await prospectsRepo.getCreatorProspectById(tx, prospectId);
    if (!prospect) throw new Error(`Creator prospect "${prospectId}" not found.`);
    if (prospect.convertedCreatorId) {
      throw new Error("This prospect has already been converted to a Founding Creator.");
    }

    const createInput: CreateCreatorInput = {
      slug: input.slug,
      name: input.name?.trim() || prospect.displayName,
      email: input.email,
      platform: input.platform ?? prospect.platform,
      profileUrl: input.profileUrl ?? prospect.profileUrl,
      notes: input.notes ?? `Converted from creator outreach prospect "${prospect.displayName}".`,
    };

    const creator = await createCreatorAdmin(tx, session, createInput);

    const linked = await prospectsRepo.markCreatorProspectConverted(tx, prospectId, creator.id);
    if (!linked) {
      throw new Error("This prospect has already been converted to a Founding Creator.");
    }
    return creator;
  });
}
