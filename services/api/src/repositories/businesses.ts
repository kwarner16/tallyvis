import type { DatabaseSync } from "node:sqlite";
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
  };
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
  db.prepare(
    `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at)
     VALUES (?, ?, ?, ?, ?, 'window-cleaning', ?)`,
  ).run(id, input.name, input.email, input.phone ?? "", input.serviceArea ?? "", createdAt);

  return { id, name: input.name, email: input.email, phone: input.phone ?? "", serviceArea: input.serviceArea ?? "", defaultIndustry: "window-cleaning", createdAt };
}

/** A business may only ever read/update its own row — callers pass the id from an already-validated session, never from client input. */
export function getBusinessById(db: DatabaseSync, id: string): Business | undefined {
  const row = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(id) as BusinessRow | undefined;
  return row ? toBusiness(row) : undefined;
}

export interface UpdateBusinessInput {
  name: string;
  email: string;
  phone: string;
  serviceArea: string;
}

export function updateBusiness(db: DatabaseSync, id: string, input: UpdateBusinessInput): Business {
  db.prepare(`UPDATE businesses SET name = ?, email = ?, phone = ?, service_area = ? WHERE id = ?`).run(
    input.name,
    input.email,
    input.phone,
    input.serviceArea,
    id,
  );
  const updated = getBusinessById(db, id);
  if (!updated) throw new Error(`Business "${id}" not found after update.`);
  return updated;
}
