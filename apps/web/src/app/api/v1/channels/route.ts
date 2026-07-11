import { publicApiHandler } from "@/lib/public-api";

/** GET /api/v1/channels — список каналов workspace. */
export const GET = publicApiHandler(async (ctx) => {
  const { data, error } = await ctx.admin
    .from("channels")
    .select(
      "id, brand_id, platform, name, username, public_url, status, last_sync_at, created_at, brands(name)"
    )
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return { channels: data };
});
