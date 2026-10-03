"use server";

import { redirect } from "next/navigation";
import {
  previewCreatorProspectImportAdmin,
  commitCreatorProspectImportAdmin,
  updateCreatorProspectAdmin,
  recordCreatorOutreachActivityAdmin,
  convertProspectToCreatorAdmin,
  type CreatorProspectImportClassification,
} from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";

/**
 * Founding Creator Outreach Tracker V1 — admin Server Actions (see
 * docs/decisions/0042-creator-outreach-tracker.md). Every action calls
 * `requireAdminContext()` first, same as every other `/admin/*` action
 * in this codebase; the `services/creatorProspects.ts`/
 * `services/creatorOutreachActivities.ts` functions underneath
 * independently re-check admin access too.
 */

export interface CreatorProspectFormState {
  error?: string;
}

export interface CreatorImportPreviewState {
  error?: string;
  rawText?: string;
  classification?: CreatorProspectImportClassification;
}

export async function previewCreatorImportAction(_prevState: CreatorImportPreviewState, formData: FormData): Promise<CreatorImportPreviewState> {
  const { db, session } = await requireAdminContext();
  const rawText = String(formData.get("rawText") ?? "");

  if (!rawText.trim()) {
    return { rawText, error: "Paste a creator prospect list first." };
  }

  try {
    const classification = await previewCreatorProspectImportAdmin(db, session, rawText);
    return { rawText, classification };
  } catch (err) {
    return { rawText, error: err instanceof Error ? err.message : "Could not parse this list." };
  }
}

export async function importCreatorProspectsAction(_prevState: CreatorImportPreviewState, formData: FormData): Promise<CreatorImportPreviewState> {
  const { db, session } = await requireAdminContext();
  const rawText = String(formData.get("rawText") ?? "");

  try {
    await commitCreatorProspectImportAdmin(db, session, rawText);
  } catch (err) {
    return { rawText, error: err instanceof Error ? err.message : "Could not import this list." };
  }

  redirect("/admin/creators/outreach");
}

export async function updateCreatorProspectAction(_prevState: CreatorProspectFormState, formData: FormData): Promise<CreatorProspectFormState> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("prospectId") ?? "");

  try {
    await updateCreatorProspectAdmin(db, session, id, {
      displayName: String(formData.get("displayName") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
      platform: String(formData.get("platform") ?? ""),
      profileUrl: String(formData.get("profileUrl") ?? ""),
      niche: String(formData.get("niche") ?? ""),
      followersApprox: String(formData.get("followersApprox") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this creator prospect." };
  }

  redirect(`/admin/creators/outreach/${id}`);
}

export interface RecordActivityFormState {
  error?: string;
}

export async function recordOutreachActivityAction(_prevState: RecordActivityFormState, formData: FormData): Promise<RecordActivityFormState> {
  const { db, session } = await requireAdminContext();
  const prospectId = String(formData.get("prospectId") ?? "");
  const status = String(formData.get("status") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const followUpAt = String(formData.get("followUpAt") ?? "").trim();

  try {
    await recordCreatorOutreachActivityAdmin(db, session, prospectId, {
      status,
      notes,
      followUpAt: followUpAt || undefined,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this activity." };
  }

  redirect("/admin/creators/outreach");
}

export interface ConvertFormState {
  error?: string;
}

export async function convertToCreatorAction(_prevState: ConvertFormState, formData: FormData): Promise<ConvertFormState> {
  const { db, session } = await requireAdminContext();
  const prospectId = String(formData.get("prospectId") ?? "");

  let creatorId: string;
  try {
    const creator = await convertProspectToCreatorAdmin(db, session, prospectId, {
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      platform: String(formData.get("platform") ?? "") || undefined,
      profileUrl: String(formData.get("profileUrl") ?? "") || undefined,
    });
    creatorId = creator.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not convert this prospect." };
  }

  redirect(`/admin/creators/${creatorId}`);
}
