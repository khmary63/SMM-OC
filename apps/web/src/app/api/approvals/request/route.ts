import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canEditContent } from "@/lib/workspace";

/** Запрос согласования конкретной версии (WF-APPROVAL-001). */
export const POST = apiHandler<{
  workspace_id?: string;
  content_variant_id?: string;
  approver_user_id?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.content_variant_id) {
    throw new ApiError("content_variant_id обязателен");
  }

  const supabase = await createClient();
  const { data: variant, error: vError } = await supabase
    .from("content_variants")
    .select("id, version_no, content_item_id")
    .eq("id", body.content_variant_id)
    .eq("workspace_id", ctx.workspaceId)
    .single();
  if (vError) throw new ApiError("Вариант не найден", 404);

  await supabase
    .from("approvals")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("content_variant_id", variant.id)
    .eq("status", "pending");

  const { data: approval, error } = await supabase
    .from("approvals")
    .insert({
      workspace_id: ctx.workspaceId,
      content_variant_id: variant.id,
      requested_by: ctx.userId,
      approver_user_id: body.approver_user_id ?? null,
      version_no: variant.version_no,
    })
    .select("id")
    .single();
  if (error) throw new ApiError(error.message);

  await supabase
    .from("content_variants")
    .update({ status: "awaiting_approval" })
    .eq("id", variant.id);

  return { approval_id: approval.id };
});
