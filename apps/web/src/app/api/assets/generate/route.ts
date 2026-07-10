import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { canEditContent } from "@/lib/workspace";
import { enqueueJob } from "@/lib/jobs";

/** Генерация изображения — асинхронный job для WF-CONTENT-002. */
export const POST = apiHandler<{
  workspace_id?: string;
  brand_id?: string;
  content_variant_id?: string;
  prompt?: string;
  dimensions?: string;
  provider?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.prompt) throw new ApiError("prompt обязателен");

  const job = await enqueueJob({
    workspaceId: ctx.workspaceId,
    jobType: "generate_image",
    entityType: "content_variant",
    entityId: body.content_variant_id,
    payload: {
      brand_id: body.brand_id,
      prompt: body.prompt,
      dimensions: body.dimensions ?? "1024x1024",
      provider: body.provider ?? "default",
      requested_by: ctx.userId,
    },
  });

  return { job_id: job.id, status: job.status };
});
