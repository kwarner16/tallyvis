import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { Business } from "@tallyvis/types";
import { makeId } from "../db/ids";

interface BusinessRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  service_area: string;
  default_industry: string;
  created_at: string;
  public_embed_id: string;
  logo_url: string | null;
  brand_color: string | null;
  embed_last_seen_at: string | null;
}

function toBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    serviceArea: row.service_area,
    defaultIndustry: "window-cleaning",
    createdAt: row.created_at,
    publicEmbedId: row.public_embed_id,
    logoUrl: row.logo_url ?? undefined,
    brandColor: row.brand_color ?? undefined,
    embedLastSeenAt: row.embed_last_seen_at ?? undefined,
  };
}

/** Same shape/entropy as `auth/session.ts`'s session tokens — opaque and unguessable, since this is the one identifier meant to appear in a public `<script>` tag. Hex, not base64url: it has to survive unescaped inside an HTML attribute and a URL path segment without encoding surprises. */
function generatePublicEmbedId(): string {
  return randomBytes(12).toString("hex");
}

export interface CreateBusinessInput {
  name: string;
  email: string;
  phone?: string;
  serviceArea?: string;
}

/** No ownership scoping here — creating a business is how a tenant boundary comes into existence in the first place. */
export function createBusiness(db: DatabaseSync, input: CreateBusinessInput): Business {
  const id = makeId("business");
  const createdAt = new Date().toISOString();
  const publicEmbedId = generatePublicEmbedId();
  db.prepare(
    `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
     VALUES (?, ?, ?, ?, ?, 'window-cleaning', ?, ?)`,
  ).run(id, input.name, input.email, input.phone ?? "", input.serviceArea ?? "", createdAt, publicEmbedId);

  return {
    id,
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
    serviceArea: input.serviceArea ?? "",
    defaultIndustry: "window-cleaning",
    createdAt,
    publicEmbedId,
  };
}

/** A business may only ever read/update its own row — callers pass the id from an already-validated session, never from client input. */
export function getBusinessById(db: DatabaseSync, id: string): Business | undefined {
  const row = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(id) as BusinessRow | undefined;
  return row ? toBusiness(row) : undefined;
}

/**
 * Resolves a business by its PUBLIC embed identifier — the one lookup in
 * this file that's safe to drive from unauthenticated, client-supplied
 * input, precisely because `publicEmbedId` (unlike `id`) is the identifier
 * designed to be public. See docs/decisions/0016-onboarding-billing-embed.md.
 */
export function getBusinessByPublicEmbedId(db: DatabaseSync, publicEmbedId: string): Business | undefined {
  const row = db.prepare(`SELECT * FROM businesses WHERE public_embed_id = ?`).get(publicEmbedId) as
    | BusinessRow
    | undefined;
  return row ? toBusiness(row) : undefined;
}

/** Best-effort "is the embed actually installed somewhere" signal for the dashboard — bumped every time the embed route resolves this business, never a guarantee of a live/working installation. */
export function touchEmbedLastSeen(db: DatabaseSync, businessId: string): void {
  db.prepare(`UPDATE businesses SET embed_last_seen_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    businessId,
  );
}

export interface UpdateBusinessInput {
  name: string;
  email: string;
  phone: string;
  serviceArea: string;
  logoUrl?: string;
  brandColor?: string;
}

export function updateBusiness(db: DatabaseSync, id: string, input: UpdateBusinessInput): Business {
  db.prepare(
    `UPDATE businesses SET name = ?, email = ?, phone = ?, service_area = ?, logo_url = ?, brand_color = ? WHERE id = ?`,
  ).run(
    input.name,
    input.email,
    input.phone,
    input.serviceArea,
    input.logoUrl ?? null,
    input.brandColor ?? null,
    id,
  );
  const updated = getBusinessById(db, id);
  if (!updated) throw new Error(`Business "${id}" not found after update.`);
  return updated;
}
