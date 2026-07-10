import "server-only";

import { createClient } from "@/lib/supabase/server";
import { enqueueJob, publicationIdempotencyKey } from "@/lib/jobs";

/**
 * Постановка публикации в очередь.
 * Условия из архитектуры §7: approved-вариант, активный канал, наличие текста/медиа,
 * время не в прошлом (или immediate), уникальный idempotency key, нет внешнего ID.
 */
export async function schedulePublication(params: {
  workspaceId: string;
  userId: string;
  contentVariantId: string;
  channelId: string;
  scheduledAt: string; // ISO
}): Promise<{ id: string; status: string; idempotency_key: string }> {
  const supabase = await createClient();

  const { data: variant, error: vError } = await supabase
    .from("content_variants")
    .select("id, status, version_no, body, title, content_item_id")
    .eq("id", params.contentVariantId)
    .eq("workspace_id", params.workspaceId)
    .single();
  if (vError) throw new Error("Вариант контента не найден");
  if (variant.status !== "approved") {
    throw new Error("Публиковать можно только согласованный вариант");
  }
  if (!variant.body?.trim()) {
    // Медиа-only посты возможны; для MVP требуем текст либо вложение.
    const { count } = await supabase
      .from("content_assets")
      .select("*", { count: "exact", head: true })
      .eq("content_variant_id", variant.id);
    if (!count) throw new Error("У варианта нет ни текста, ни медиа");
  }

  const { data: channel, error: cError } = await supabase
    .from("channels")
    .select("id, status, platform")
    .eq("id", params.channelId)
    .eq("workspace_id", params.workspaceId)
    .single();
  if (cError) throw new Error("Канал не найден");
  if (channel.status !== "active") {
    throw new Error("Канал не активен — проверьте подключение");
  }

  const scheduledAt = new Date(params.scheduledAt);
  const now = Date.now();
  if (scheduledAt.getTime() < now - 5 * 60 * 1000) {
    throw new Error("Время публикации в прошлом");
  }

  const idempotencyKey = publicationIdempotencyKey({
    workspaceId: params.workspaceId,
    channelId: params.channelId,
    contentVariantId: params.contentVariantId,
    scheduledAt: scheduledAt.toISOString(),
    versionNo: variant.version_no,
  });

  const { data: existing } = await supabase
    .from("publications")
    .select("id, status, idempotency_key")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return existing;

  const { data: publication, error } = await supabase
    .from("publications")
    .insert({
      workspace_id: params.workspaceId,
      content_variant_id: params.contentVariantId,
      channel_id: params.channelId,
      scheduled_at: scheduledAt.toISOString(),
      status: "queued",
      idempotency_key: idempotencyKey,
      created_by: params.userId,
    })
    .select("id, status, idempotency_key")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("content_variants")
    .update({ status: "scheduled", scheduled_at: scheduledAt.toISOString() })
    .eq("id", variant.id);
  await supabase
    .from("content_items")
    .update({ status: "scheduled" })
    .eq("id", variant.content_item_id)
    .eq("status", "approved");

  // Публикацией занимается WF-PUB-001 (n8n): создаём job для надёжности.
  await enqueueJob({
    workspaceId: params.workspaceId,
    jobType: "publish",
    entityType: "publication",
    entityId: publication.id,
    idempotencyKey: `publish:${idempotencyKey}`,
    runAfter: scheduledAt,
    payload: { platform: channel.platform },
  });

  return publication;
}

export async function cancelPublication(params: {
  workspaceId: string;
  publicationId: string;
}): Promise<void> {
  const supabase = await createClient();

  const { data: publication, error } = await supabase
    .from("publications")
    .select("id, status, content_variant_id")
    .eq("id", params.publicationId)
    .eq("workspace_id", params.workspaceId)
    .single();
  if (error) throw new Error("Публикация не найдена");

  if (!["draft", "queued", "failed"].includes(publication.status)) {
    throw new Error("Отменить можно только публикацию в очереди");
  }

  const { error: updError } = await supabase
    .from("publications")
    .update({ status: "cancelled" })
    .eq("id", publication.id)
    .in("status", ["draft", "queued", "failed"]);
  if (updError) throw new Error(updError.message);

  await supabase
    .from("content_variants")
    .update({ status: "approved" })
    .eq("id", publication.content_variant_id)
    .eq("status", "scheduled");
}
