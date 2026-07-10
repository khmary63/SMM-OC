import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { enqueueJob } from "@/lib/jobs";

/** Ручная синхронизация метрик канала или всех каналов workspace. */
export const POST = apiHandler<{
  workspace_id?: string;
  channel_id?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);

  const job = await enqueueJob({
    workspaceId: ctx.workspaceId,
    jobType: "collect_channel_metrics",
    entityType: body.channel_id ? "channel" : "workspace",
    entityId: body.channel_id ?? ctx.workspaceId,
    payload: { manual: true, requested_by: ctx.userId },
  });

  return { job_id: job.id, status: job.status };
});
