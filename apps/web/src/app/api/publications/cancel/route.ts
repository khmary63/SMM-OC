import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canPublish } from "@/lib/workspace";
import { cancelPublication } from "@/lib/publications";

export const POST = apiHandler<{
  workspace_id?: string;
  publication_id?: string;
}>(async (body) => {
  if (!body.publication_id) throw new ApiError("publication_id обязателен");

  let workspaceId = body.workspace_id;
  if (!workspaceId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("publications")
      .select("workspace_id")
      .eq("id", body.publication_id)
      .maybeSingle();
    workspaceId = data?.workspace_id;
  }

  const ctx = await requireApiContext(workspaceId);
  if (!canPublish(ctx.role)) throw new ApiError("Недостаточно прав", 403);

  await cancelPublication({
    workspaceId: ctx.workspaceId,
    publicationId: body.publication_id,
  });

  return { ok: true };
});
