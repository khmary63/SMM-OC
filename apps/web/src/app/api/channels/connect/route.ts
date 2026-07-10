import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAdmin } from "@/lib/workspace";
import { enqueueJob } from "@/lib/jobs";

export const POST = apiHandler<{
  workspace_id?: string;
  brand_id?: string;
  platform?: string;
  name?: string;
  external_channel_id?: string;
  username?: string;
  public_url?: string;
  token?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canAdmin(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.brand_id || !body.platform || !body.name) {
    throw new ApiError("brand_id, platform и name обязательны");
  }

  const supabase = await createClient();
  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: ctx.workspaceId,
      brand_id: body.brand_id,
      platform: body.platform,
      name: body.name,
      external_channel_id: body.external_channel_id ?? null,
      username: body.username ?? null,
      public_url: body.public_url ?? null,
      status: body.token ? "active" : "disconnected",
    })
    .select("id, status")
    .single();
  if (error) throw new ApiError(error.message);

  if (body.token) {
    const admin = createAdminClient();
    const { data: secretRef, error: vaultError } = await admin.rpc(
      "store_integration_secret",
      {
        p_workspace_id: ctx.workspaceId,
        p_channel_id: channel.id,
        p_secret: body.token,
      }
    );
    if (vaultError) throw new ApiError(vaultError.message, 500);

    const { error: connError } = await admin
      .from("integration_connections")
      .insert({
        workspace_id: ctx.workspaceId,
        channel_id: channel.id,
        provider: body.platform,
        auth_type: body.platform === "vk" ? "access_token" : "bot_token",
        secret_ref: secretRef as string,
        status: "active",
      });
    if (connError) throw new ApiError(connError.message, 500);

    await enqueueJob({
      workspaceId: ctx.workspaceId,
      jobType: "integration_health_check",
      entityType: "channel",
      entityId: channel.id,
    });
  }

  return channel;
});
