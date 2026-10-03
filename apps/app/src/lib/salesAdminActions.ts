"use server";

import { redirect } from "next/navigation";
import {
  previewProspectImportAdmin,
  commitProspectImportAdmin,
  updateSalesProspectAdmin,
  startSalesCallAdmin,
  endSalesCallAdmin,
  type ProspectImportClassification,
} from "@tallyvis/api";
import { requireAdminContext } from "@/lib/adminSession";

/**
 * Sales Call Tracker V1 — admin Server Actions (see
 * docs/decisions/0041-sales-call-tracker.md). Every action calls
 * `requireAdminContext()` first, same as every other `/admin/*` action in
 * this codebase; the `services/sales*.ts` functions underneath
 * independently re-check admin access too.
 */

export interface ProspectFormState {
  error?: string;
}

export interface ImportPreviewState {
  error?: string;
  rawText?: string;
  classification?: ProspectImportClassification;
}

export async function previewImportAction(_prevState: ImportPreviewState, formData: FormData): Promise<ImportPreviewState> {
  const { db, session } = await requireAdminContext();
  const rawText = String(formData.get("rawText") ?? "");

  if (!rawText.trim()) {
    return { rawText, error: "Paste a prospect list first." };
  }

  try {
    const classification = await previewProspectImportAdmin(db, session, rawText);
    return { rawText, classification };
  } catch (err) {
    return { rawText, error: err instanceof Error ? err.message : "Could not parse this list." };
  }
}

export async function importProspectsAction(_prevState: ImportPreviewState, formData: FormData): Promise<ImportPreviewState> {
  const { db, session } = await requireAdminContext();
  const rawText = String(formData.get("rawText") ?? "");

  try {
    await commitProspectImportAdmin(db, session, rawText);
  } catch (err) {
    return { rawText, error: err instanceof Error ? err.message : "Could not import this list." };
  }

  redirect("/admin/sales");
}

export async function updateProspectAction(_prevState: ProspectFormState, formData: FormData): Promise<ProspectFormState> {
  const { db, session } = await requireAdminContext();
  const id = String(formData.get("prospectId") ?? "");

  try {
    await updateSalesProspectAdmin(db, session, id, {
      businessName: String(formData.get("businessName") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      website: String(formData.get("website") ?? ""),
      city: String(formData.get("city") ?? ""),
      state: String(formData.get("state") ?? ""),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this prospect." };
  }

  redirect(`/admin/sales/${id}`);
}

export async function startCallAction(formData: FormData): Promise<void> {
  const { db, session } = await requireAdminContext();
  const prospectId = String(formData.get("prospectId") ?? "");
  const call = await startSalesCallAdmin(db, session, prospectId);
  redirect(`/admin/sales/call/${call.id}`);
}

export interface EndCallFormState {
  error?: string;
}

export async function endCallAction(_prevState: EndCallFormState, formData: FormData): Promise<EndCallFormState> {
  const { db, session } = await requireAdminContext();
  const callId = String(formData.get("callId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const objections = formData.getAll("objections").map(String);
  const followUpAt = String(formData.get("followUpAt") ?? "").trim();

  try {
    await endSalesCallAdmin(db, session, callId, {
      outcome,
      notes,
      objections,
      followUpAt: followUpAt || undefined,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this call." };
  }

  redirect("/admin/sales");
}
