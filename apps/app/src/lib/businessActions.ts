"use server";

import { revalidatePath } from "next/cache";
import type { Business } from "@tallyvis/types";
import { updateCurrentBusiness, type UpdateBusinessInput } from "@tallyvis/api";
import { requireContext } from "./session";

export async function updateBusinessAction(input: UpdateBusinessInput): Promise<Business> {
  const { db, session } = await requireContext();
  const business = await updateCurrentBusiness(db, session, input);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return business;
}
