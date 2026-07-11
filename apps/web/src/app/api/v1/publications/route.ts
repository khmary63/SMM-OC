import { createHash } from "crypto";
import { PublicApiError, publicApiHandler } from "@/lib/public-api";
import { enqueueJob } from "@/lib/jobs";
import { emitWorkspaceEvent } from "@/lib/webhooks";

/** GET /api/v1/publications — список публикаций (фильтры: status, channel_id, limit). */
export const GET = publicApiHandler(async (ctx, _body, request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const channelId = url.searchParams.get("channel_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  let query = ctx.admin
    .from("publications")
    .select(
      "id, content_variant_id, channel_id, scheduled_at, status, external_post_id, external_url, published_at, failure_code, failure_message, created_at"
    )
    .eq("workspace_id", ctx.workspaceId)
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (channelId) query = query.eq("channel_id", channelId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { publications: data };
});

/**
 * POST /api/v1/publications — поставить публикацию в очередь.
 * Требует согласованный (approved) вариант и активный канал —
 * те же инварианты, что и в интерфейсе (§7 спецификации).
 */
export const POST = publicApiHandler<{
  content_variant_id?: string;
  channel_id?: string;
  scheduled_at?: string;
}>(async (ctx, body) => {
  if (!body.content_variant_id || !body.channel_id) {
    throw new PublicApiError("content_variant_id и channel_id обязательны");
  }

  const { data: variant } = await ctx.admin
    .from("content_variants")
    .select("id, status, version_no, body, content_item_id")
    .eq("id", body.content_variant_id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!variant) throw new PublicApiError("Вариант контента не найден", 404);
  if (variant.status !== "approved") {
    throw new PublicApiError(
      "Публиковать можно только согласованный вариант (status=approved)"
    );
  }

  const { data: channel } = await ctx.admin
    .from("channels")
    .select("id, status, platform")
    .eq("id", body.channel_id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!channel) throw new PublicApiError("Канал не найден", 404);
  if (channel.status !== "active") {
    throw new PublicApiError("Канал не активен");
  }

  const scheduledAt = new Date(body.scheduled_at ?? Date.now());
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new PublicApiError("scheduled_at: неверный формат даты (ISO 8601)");
  }
  if (scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
    throw new PublicApiError("Время публикации в прошлом");
  }

  const idempotencyKey = createHash("sha256")
    .update(
      [
        ctx.workspaceId,
        channel.id,
        variant.id,
        scheduledAt.toISOString(),
        String(variant.version_no),
      ].join("|")
    )
    .digest("hex");

  const { data: existing } = await ctx.admin
    .from("publications")
    .select("id, status, idempotency_key")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return { publication: existing, deduplicated: true };

  const { data: publication, error } = await ctx.admin
    .from("publications")
    .insert({
      workspace_id: ctx.workspaceId,
      content_variant_id: variant.id,
      channel_id: channel.id,
      scheduled_at: scheduledAt.toISOString(),
      status: "queued",
      idempotency_key: idempotencyKey,
    })
    .select("id, status, scheduled_at, idempotency_key")
    .single();
  if (error) throw new Error(error.message);

  await ctx.admin
    .from("content_variants")
    .update({ status: "scheduled", scheduled_at: scheduledAt.toISOString() })
    .eq("id", variant.id);

  await enqueueJob({
    workspaceId: ctx.workspaceId,
    jobType: "publish",
    entityType: "publication",
    entityId: publication.id,
    idempotencyKey: `publish:${idempotencyKey}`,
    runAfter: scheduledAt,
    payload: { platform: channel.platform, source: "public_api" },
  });

  await emitWorkspaceEvent(ctx.workspaceId, "publication.queued", {
    publication_id: publication.id,
    channel_id: channel.id,
    scheduled_at: publication.scheduled_at,
    source: "public_api",
  });

  return { publication };
});
