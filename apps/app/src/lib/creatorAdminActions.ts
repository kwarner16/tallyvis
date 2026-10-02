"use server";

import { redirect } from "next/navigation";
import {
  createCreatorAdmin,
  updateCreatorAdmin,
  linkCreatorBusinessAdmin,
  setCreatorComplimentaryAccessAdmin,
  markCommissionPaidAdmin,
  recordCreatorActivityAdmin,
  type CreatorStatus,
} from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";

/**
 * TallyVis Founding Creator Program — admin Server Actions (see
 * docs/decisions/0040-creator-affiliate-program.md). Every action calls
 * `requireAdminContext()` first (the same page-level gate every
 * `/admin/*` page already calls) — the `services/creators.ts` functions
 * underneath independently re-check admin access too, the deliberate
 * defense-in-depth `services/admin.ts` already establishes.
 */

export interface CreatorFormState {
  error?: string;
}

function parseIntOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

export async function createCreatorAction(_prevState: CreatorFormState, formData: FormData): Promise<CreatorFormState> {
  const { db, session } = await requireAdminContext();

  let creatorId: string;
  try {
    const creator = await createCreatorAdmin(db, session, {
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      platform: String(formData.get("platform") ?? ""),
      profileUrl: String(formData.get("profileUrl") ?? ""),
      commissionRateBps: parseIntOrUndefined(formData.get("commissionRateBps")),
      commissionDurationMonths: parseIntOrUndefined(formData.get("commissionDurationMonths")),
      notes: String(formData.get("notes") ?? ""),
    });
    creatorId = creator.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this creator." };
  }

  redirect(`/admin/creators/${creatorId}`);
}

export async function updateCreatorAction(_prevState: CreatorFormState, formData: FormData): Promise<CreatorFormState> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("creatorId") ?? "");

  try {
    await updateCreatorAdmin(db, session, id, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      platform: String(formData.get("platform") ?? ""),
      profileUrl: String(formData.get("profileUrl") ?? ""),
      commissionRateBps: parseIntOrUndefined(formData.get("commissionRateBps")),
      commissionDurationMonths: parseIntOrUndefined(formData.get("commissionDurationMonths")),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this creator." };
  }

  redirect(`/admin/creators/${id}`);
}

export async function setCreatorStatusAction(formData: FormData): Promise<void> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("creatorId") ?? "");
  const status = String(formData.get("status") ?? "") as CreatorStatus;
  await updateCreatorAdmin(db, session, id, { status });
  redirect(`/admin/creators/${id}`);
}

export async function linkCreatorBusinessAction(_prevState: CreatorFormState, formData: FormData): Promise<CreatorFormState> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("creatorId") ?? "");
  const businessId = String(formData.get("businessId") ?? "").trim();

  try {
    await linkCreatorBusinessAdmin(db, session, id, businessId || null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not link this business." };
  }

  redirect(`/admin/creators/${id}`);
}

export async function unlinkCreatorBusinessAction(formData: FormData): Promise<void> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("creatorId") ?? "");
  await linkCreatorBusinessAdmin(db, session, id, null);
  redirect(`/admin/creators/${id}`);
}

export async function setComplimentaryAccessAction(formData: FormData): Promise<void> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("creatorId") ?? "");
  const enabled = formData.get("enabled") === "true";
  await setCreatorComplimentaryAccessAdmin(db, session, id, enabled);
  redirect(`/admin/creators/${id}`);
}

export async function markCommissionPaidAction(formData: FormData): Promise<void> {
  const { db, session } = await requireAdminContext();
  const creatorId = String(formData.get("creatorId") ?? "");
  const commissionId = String(formData.get("commissionId") ?? "");
  const payoutNote = String(formData.get("payoutNote") ?? "");
  await markCommissionPaidAdmin(db, session, commissionId, payoutNote);
  redirect(`/admin/creators/${creatorId}`);
}

export async function recordCreatorActivityAction(_prevState: CreatorFormState, formData: FormData): Promise<CreatorFormState> {
  const { db, session } = await requireAdminContext();
  const creatorId = String(formData.get("creatorId") ?? "");

  try {
    await recordCreatorActivityAdmin(db, session, creatorId, {
      contentAt: String(formData.get("contentAt") ?? ""),
      contentUrl: String(formData.get("contentUrl") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record this activity." };
  }

  redirect(`/admin/creators/${creatorId}`);
}
