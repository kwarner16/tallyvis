import { randomBytes } from "node:crypto";
import type { Business } from "@tallyvis/types";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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
export async function createBusiness(db: Queryable, input: CreateBusinessInput): Promise<Business> {
  const id = makeId("business");
  const createdAt = new Date().toISOString();
  const publicEmbedId = generatePublicEmbedId();
  await db.query(
    `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
     VALUES ($1, $2, $3, $4, $5, 'window-cleaning', $6, $7)`,
    [id, input.name, input.email, input.phone ?? "", input.serviceArea ?? "", createdAt, publicEmbedId],
  );

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
export async function getBusinessById(db: Queryable, id: string): Promise<Business | undefined> {
  const result = await db.query<BusinessRow>(`SELECT * FROM businesses WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toBusiness(row) : undefined;
}

/**
 * Resolves a business by its PUBLIC embed identifier — the one lookup in
 * this file that's safe to drive from unauthenticated, client-supplied
 * input, precisely because `publicEmbedId` (unlike `id`) is the identifier
 * designed to be public. See docs/decisions/0016-onboarding-billing-embed.md.
 */
export async function getBusinessByPublicEmbedId(db: Queryable, publicEmbedId: string): Promise<Business | undefined> {
  const result = await db.query<BusinessRow>(`SELECT * FROM businesses WHERE public_embed_id = $1`, [publicEmbedId]);
  const row = result.rows[0];
  return row ? toBusiness(row) : undefined;
}

/** Best-effort "is the embed actually installed somewhere" signal for the dashboard — bumped every time the embed route resolves this business, never a guarantee of a live/working installation. */
export async function touchEmbedLastSeen(db: Queryable, businessId: string): Promise<void> {
  await db.query(`UPDATE businesses SET embed_last_seen_at = $1 WHERE id = $2`, [
    new Date().toISOString(),
    businessId,
  ]);
}

export interface UpdateBusinessInput {
  name: string;
  email: string;
  phone: string;
  serviceArea: string;
  logoUrl?: string;
  brandColor?: string;
}

export async function updateBusiness(db: Queryable, id: string, input: UpdateBusinessInput): Promise<Business> {
  await db.query(
    `UPDATE businesses SET name = $1, email = $2, phone = $3, service_area = $4, logo_url = $5, brand_color = $6 WHERE id = $7`,
    [input.name, input.email, input.phone, input.serviceArea, input.logoUrl ?? null, input.brandColor ?? null, id],
  );
  const updated = await getBusinessById(db, id);
  if (!updated) throw new Error(`Business "${id}" not found after update.`);
  return updated;
}
