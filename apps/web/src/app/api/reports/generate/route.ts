import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs";

/** Постановка формирования месячного отчёта (WF-REPORT-001). */
export const POST = apiHandler<{
  workspace_id?: string;
  brand_id?: string;
  report_month?: string; // YYYY-MM
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!body.brand_id || !body.report_month) {
    throw new ApiError("brand_id и report_month обязательны");
  }

  const monthDate = `${body.report_month}-01`;
  const periodStart = monthDate;
  const [y, m] = body.report_month.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from("monthly_reports")
    .upsert(
      {
        workspace_id: ctx.workspaceId,
        brand_id: body.brand_id,
        report_month: monthDate,
        period_start: periodStart,
        period_end: periodEnd,
        status: "pending",
        generated_by: ctx.userId,
      },
      { onConflict: "brand_id,report_month" }
    )
    .select("id")
    .single();
  if (error) throw new ApiError(error.message);

  const job = await enqueueJob({
    workspaceId: ctx.workspaceId,
    jobType: "generate_report",
    entityType: "monthly_report",
    entityId: report.id,
    idempotencyKey: `report:${body.brand_id}:${body.report_month}`,
    payload: { brand_id: body.brand_id, report_month: body.report_month },
  });

  return { report_id: report.id, job_id: job.id };
});
