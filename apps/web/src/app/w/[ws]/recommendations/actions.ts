"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, canEditContent } from "@/lib/workspace";

export async function setRecommendationStatus(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const status = String(formData.get("status"));
  if (!["accepted", "rejected", "implemented"].includes(status)) {
    throw new Error("Недопустимый статус");
  }

  const { error } = await supabase
    .from("recommendations")
    .update({
      status,
      accepted_by: status === "accepted" ? ctx.userId : null,
    })
    .eq("id", String(formData.get("recommendation_id")))
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/recommendations`);
}
