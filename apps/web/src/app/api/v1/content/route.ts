import { PublicApiError, publicApiHandler } from "@/lib/public-api";
import { emitWorkspaceEvent } from "@/lib/webhooks";

/** GET /api/v1/content — список единиц контента (фильтры: brand_id, status, limit). */
export const GET = publicApiHandler(async (ctx, _body, request) => {
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brand_id");
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  let query = ctx.admin
    .from("content_items")
    .select(
      "id, brand_id, title, topic, rubric, goal, format, status, planned_at, ai_generated, created_at, updated_at"
    )
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (brandId) query = query.eq("brand_id", brandId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { content: data };
});

/** POST /api/v1/content — создать единицу контента (и опционально вариант с текстом). */
export const POST = publicApiHandler<{
  brand_id?: string;
  title?: string;
  topic?: string;
  rubric?: string;
  format?: string;
  planned_at?: string;
  body?: string;
  channel_id?: string;
}>(async (ctx, body) => {
  if (!body.brand_id || !body.title) {
    throw new PublicApiError("brand_id и title обязательны");
  }

  const { data: brand } = await ctx.admin
    .from("brands")
    .select("id")
    .eq("id", body.brand_id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!brand) throw new PublicApiError("Бренд не найден", 404);

  const { data: item, error } = await ctx.admin
    .from("content_items")
    .insert({
      workspace_id: ctx.workspaceId,
      brand_id: body.brand_id,
      title: body.title,
      topic: body.topic ?? null,
      rubric: body.rubric ?? null,
      format: body.format ?? "text",
      base_text: body.body ?? null,
      status: body.planned_at ? "planned" : "idea",
      planned_at: body.planned_at ?? null,
      metadata: { source: "public_api" },
    })
    .select("id, title, status")
    .single();
  if (error) throw new Error(error.message);

  let variantId: string | null = null;
  if (body.body) {
    const { data: variant } = await ctx.admin
      .from("content_variants")
      .insert({
        workspace_id: ctx.workspaceId,
        content_item_id: item.id,
        channel_id: body.channel_id ?? null,
        version_no: 1,
        body: body.body,
        status: "in_progress",
      })
      .select("id")
      .single();
    variantId = variant?.id ?? null;
  }

  await emitWorkspaceEvent(ctx.workspaceId, "content.created", {
    content_item_id: item.id,
    title: item.title,
    source: "public_api",
  });

  return { content_item: item, content_variant_id: variantId };
});
