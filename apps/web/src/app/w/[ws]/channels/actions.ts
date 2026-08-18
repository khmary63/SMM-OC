"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace, canAdmin } from "@/lib/workspace";
import { enqueueJob } from "@/lib/jobs";

/**
 * Подключение канала.
 * Токен НЕ сохраняется в публичной таблице: он передаётся в app_private-хранилище
 * (Supabase Vault / secret resolver), а в integration_connections остаётся только secret_ref.
 * В MVP secret_ref указывает на запись в vault-таблице, доступной только service role.
 */
export async function connectChannel(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const brandId = String(formData.get("brand_id"));
  const platform = String(formData.get("platform"));
  const name = String(formData.get("name") ?? "").trim();
  const externalChannelId =
    String(formData.get("external_channel_id") ?? "").trim() || null;
  const username = String(formData.get("username") ?? "").trim() || null;
  const publicUrl = String(formData.get("public_url") ?? "").trim() || null;
  const token = String(formData.get("token") ?? "").trim();

  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: ctx.workspace.id,
      brand_id: brandId,
      platform,
      name,
      external_channel_id: externalChannelId,
      username,
      public_url: publicUrl,
      status: token ? "active" : "disconnected",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (token) {
    const admin = createAdminClient();
    // Vault: сохраняем секрет через RPC (см. миграцию 20260710000003_vault.sql).
    const { data: secretRef, error: vaultError } = await admin.rpc(
      "store_integration_secret",
      {
        p_workspace_id: ctx.workspace.id,
        p_channel_id: channel.id,
        p_secret: token,
      }
    );
    if (vaultError) throw new Error(vaultError.message);

    const { error: connError } = await admin
      .from("integration_connections")
      .insert({
        workspace_id: ctx.workspace.id,
        channel_id: channel.id,
        provider: platform,
        auth_type: platform === "vk" ? "access_token" : "bot_token",
        secret_ref: secretRef as string,
        status: "active",
      });
    if (connError) throw new Error(connError.message);

    // Health-check соединения (WF-OPS-001)
    await enqueueJob({
      workspaceId: ctx.workspace.id,
      jobType: "integration_health_check",
      entityType: "channel",
      entityId: channel.id,
    });
  }

  revalidatePath(`/w/${ws}/channels`);
}

export async function disconnectChannel(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const channelId = String(formData.get("channel_id"));
  const { error } = await supabase
    .from("channels")
    .update({ status: "disabled" })
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/channels`);
}

/**
 * Включение ранее отключённого канала. Если для него уже есть
 * действующее подключение (токен в vault) — возвращаем «active»,
 * иначе «disconnected» (как у только что созданного канала без токена).
 */
export async function enableChannel(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const channelId = String(formData.get("channel_id"));

  const { data: connection } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("channel_id", channelId)
    .maybeSingle();

  const { error } = await supabase
    .from("channels")
    .update({
      status: connection ? "active" : "disconnected",
      sync_error: null,
    })
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);

  if (connection) {
    await enqueueJob({
      workspaceId: ctx.workspace.id,
      jobType: "integration_health_check",
      entityType: "channel",
      entityId: channelId,
    });
  }

  revalidatePath(`/w/${ws}/channels`);
}

/**
 * Редактирование данных канала. Токен необязателен — если поле пустое,
 * текущий секрет не трогаем; если заполнено, ротируем его через vault
 * (store_integration_secret заменяет секрет и возвращает новый secret_ref).
 */
export async function updateChannel(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const channelId = String(formData.get("channel_id"));
  const name = String(formData.get("name") ?? "").trim();
  const externalChannelId =
    String(formData.get("external_channel_id") ?? "").trim() || null;
  const username = String(formData.get("username") ?? "").trim() || null;
  const publicUrl = String(formData.get("public_url") ?? "").trim() || null;
  const token = String(formData.get("token") ?? "").trim();

  if (!name) throw new Error("Название канала не может быть пустым");

  const { data: channel, error: chError } = await supabase
    .from("channels")
    .update({
      name,
      external_channel_id: externalChannelId,
      username,
      public_url: publicUrl,
    })
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .select("platform")
    .single();
  if (chError) throw new Error(chError.message);

  if (token) {
    const admin = createAdminClient();
    const { data: secretRef, error: vaultError } = await admin.rpc(
      "store_integration_secret",
      {
        p_workspace_id: ctx.workspace.id,
        p_channel_id: channelId,
        p_secret: token,
      }
    );
    if (vaultError) throw new Error(vaultError.message);

    const { data: existingConn } = await admin
      .from("integration_connections")
      .select("id")
      .eq("channel_id", channelId)
      .maybeSingle();

    if (existingConn) {
      const { error: connError } = await admin
        .from("integration_connections")
        .update({ secret_ref: secretRef as string, status: "active" })
        .eq("id", existingConn.id);
      if (connError) throw new Error(connError.message);
    } else {
      const { error: connError } = await admin
        .from("integration_connections")
        .insert({
          workspace_id: ctx.workspace.id,
          channel_id: channelId,
          provider: channel.platform,
          auth_type: channel.platform === "vk" ? "access_token" : "bot_token",
          secret_ref: secretRef as string,
          status: "active",
        });
      if (connError) throw new Error(connError.message);
    }

    await supabase
      .from("channels")
      .update({ status: "active", sync_error: null })
      .eq("id", channelId);

    await enqueueJob({
      workspaceId: ctx.workspace.id,
      jobType: "integration_health_check",
      entityType: "channel",
      entityId: channelId,
    });
  }

  revalidatePath(`/w/${ws}/channels`);
}

/**
 * Полное удаление канала. Разрешено, только если по каналу ещё нет
 * публикаций (защита БД: publications.channel_id — on delete restrict).
 * Черновики адаптаций контента для этого канала удалятся вместе с ним
 * (content_variants.channel_id — on delete cascade), это ожидаемо.
 */
export async function deleteChannel(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const channelId = String(formData.get("channel_id"));
  const { error } = await supabase
    .from("channels")
    .delete()
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "По этому каналу уже есть публикации — удалить нельзя, чтобы не потерять историю. Используйте «Отключить»."
      );
    }
    throw new Error(error.message);
  }
  revalidatePath(`/w/${ws}/channels`);
}

export async function syncChannelMetrics(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  const channelId = String(formData.get("channel_id"));

  await enqueueJob({
    workspaceId: ctx.workspace.id,
    jobType: "collect_channel_metrics",
    entityType: "channel",
    entityId: channelId,
    payload: { manual: true, requested_by: ctx.userId },
  });

  revalidatePath(`/w/${ws}/channels`);
}
