import { publicApiHandler } from "@/lib/public-api";

/** GET /api/v1/me — информация о workspace, к которому привязан ключ. */
export const GET = publicApiHandler(async (ctx) => {
  const { data: workspace } = await ctx.admin
    .from("workspaces")
    .select("id, name, slug, timezone, created_at")
    .eq("id", ctx.workspaceId)
    .single();

  const [{ count: brands }, { count: channels }] = await Promise.all([
    ctx.admin
      .from("brands")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId),
    ctx.admin
      .from("channels")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId),
  ]);

  return { workspace, stats: { brands, channels } };
});
