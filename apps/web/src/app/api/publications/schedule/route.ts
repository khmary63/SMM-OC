import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canPublish } from "@/lib/workspace";
import { schedulePublication } from "@/lib/publications";

export const POST = apiHandler<{
  workspace_id?: string;
  content_variant_id?: string;
  channel_id?: string;
  scheduled_at?: string;
}>(async (body) => {
  if (!body.content_variant_id || !body.channel_id) {
    throw new ApiError("content_variant_id и channel_id обязательны");
  }

  // workspace_id можно не передавать — берём из варианта (RLS гарантирует доступ).
  let workspaceId = body.workspace_id;
  if (!workspaceId) {
    const supabase = await createClient();
    const { data: variant } = await supabase
      .from("content_variants")
      .select("workspace_id")
      .eq("id", body.content_variant_id)
      .maybeSingle();
    workspaceId = variant?.workspace_id;
  }

  const ctx = await requireApiContext(workspaceId);
  if (!canPublish(ctx.role)) throw new ApiError("Недостаточно прав", 403);

  const publication = await schedulePublication({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    contentVariantId: body.content_variant_id,
    channelId: body.channel_id,
    scheduledAt: body.scheduled_at ?? new Date().toISOString(),
  });

  return publication;
});
