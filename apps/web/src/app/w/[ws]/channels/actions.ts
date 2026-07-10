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
