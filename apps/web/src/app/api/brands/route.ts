import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canEditContent, slugify } from "@/lib/workspace";

export const POST = apiHandler<{
  workspace_id?: string;
  name?: string;
  description?: string;
  timezone?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);

  const name = body.name?.trim();
  if (!name) throw new ApiError("name обязателен");

  const supabase = await createClient();
  const { data: brand, error } = await supabase
    .from("brands")
    .insert({
      workspace_id: ctx.workspaceId,
      name,
      slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 5)}`,
      description: body.description ?? null,
      timezone: body.timezone ?? "Europe/Moscow",
      created_by: ctx.userId,
    })
    .select("id, name, slug")
    .single();
  if (error) throw new ApiError(error.message);

  await supabase
    .from("brand_profiles")
    .insert({ workspace_id: ctx.workspaceId, brand_id: brand.id });

  return brand;
});
