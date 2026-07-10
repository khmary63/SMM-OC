import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import type { Brand, MonthlyReport } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { RequestReportForm } from "./request-form";

const STATUS_LABELS: Record<string, string> = {
  pending: "В очереди",
  processing: "Формируется",
  succeeded: "Готов",
  failed: "Ошибка",
  cancelled: "Отменён",
};

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: reports }, { data: brands }] = await Promise.all([
    supabase
      .from("monthly_reports")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("report_month", { ascending: false })
      .limit(24),
    supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
  ]);

  return (
    <div>
      <PageHeader
        title="Отчёты"
        subtitle="Месячные отчёты по брендам: метрики, выводы и ограничения данных."
      />

      <RequestReportForm
        workspaceId={ctx.workspace.id}
        brands={((brands ?? []) as Pick<Brand, "id" | "name">[]).map((b) => ({
          id: b.id,
          name: b.name,
        }))}
      />

      <div className="mt-6 space-y-2">
        {((reports ?? []) as (MonthlyReport & { brands: { name: string } | null })[]).map(
          (r) => (
            <div key={r.id} className="card flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.brands?.name} ·{" "}
                  {new Date(r.report_month).toLocaleDateString("ru-RU", {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Период: {formatDate(r.period_start)}–{formatDate(r.period_end)}
                  {r.generated_at && ` · сформирован ${formatDateTime(r.generated_at)}`}
                </p>
              </div>
              <span
                className={`badge ${
                  r.status === "succeeded"
                    ? "bg-emerald-50 text-emerald-700"
                    : r.status === "failed"
                      ? "bg-red-50 text-red-700"
                      : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {STATUS_LABELS[r.status] ?? r.status}
              </span>
            </div>
          )
        )}
      </div>

      {(!reports || reports.length === 0) && (
        <div className="mt-6">
          <EmptyState
            title="Отчётов пока нет"
            description="Запросите первый отчёт — он будет сформирован после накопления метрик за период."
          />
        </div>
      )}
    </div>
  );
}
