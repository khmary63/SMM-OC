"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, canPublish } from "@/lib/workspace";
import { cancelPublication } from "@/lib/publications";
import { enqueueJob } from "@/lib/jobs";

export async function cancelPublicationAction(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canPublish(ctx.role)) throw new Error("Недостаточно прав");

  await cancelPublication({
    workspaceId: ctx.workspace.id,
    publicationId: String(formData.get("publication_id")),
  });
  revalidatePath(`/w/${ws}/publications`);
}

/** Ручной retry: возвращаем failed-публикацию в очередь (failed -> queued по §7). */
export async function retryPublicationAction(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canPublish(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const publicationId = String(formData.get("publication_id"));

  const { data: publication, error } = await supabase
    .from("publications")
    .update({
      status: "queued",
      next_retry_at: new Date().toISOString(),
      failure_code: null,
      failure_message: null,
    })
    .eq("id", publicationId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "failed")
    .select("id, channel_id")
    .single();
  if (error) throw new Error("Публикация не найдена или не в статусе failed");

  await enqueueJob({
    workspaceId: ctx.workspace.id,
    jobType: "publish",
    entityType: "publication",
    entityId: publication.id,
    idempotencyKey: `publish-retry:${publication.id}:${Date.now()}`,
  });

  revalidatePath(`/w/${ws}/publications`);
}
