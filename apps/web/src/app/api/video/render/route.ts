import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { canEditContent } from "@/lib/workspace";
import { enqueueJob } from "@/lib/jobs";

/** Постановка рендера видео — job для WF-CONTENT-003 (Remotion/FFmpeg worker). */
export const POST = apiHandler<{
  workspace_id?: string;
  template_id?: string;
  content_variant_id?: string;
  asset_ids?: string[];
  render_options?: Record<string, unknown>;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.template_id) throw new ApiError("template_id обязателен");

  const job = await enqueueJob({
    workspaceId: ctx.workspaceId,
    jobType: "render_video",
    entityType: "content_variant",
    entityId: body.content_variant_id,
    payload: {
      template_id: body.template_id,
      asset_ids: body.asset_ids ?? [],
      render_options: body.render_options ?? {},
      requested_by: ctx.userId,
    },
  });

  return { job_id: job.id, status: job.status };
});
