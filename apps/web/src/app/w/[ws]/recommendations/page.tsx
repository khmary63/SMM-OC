import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import type { Insight, Recommendation } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { setRecommendationStatus } from "./actions";

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Высокая уверенность",
  medium: "Средняя уверенность",
  low: "Низкая уверенность",
  insufficient: "Недостаточно данных",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-sky-50 text-sky-700",
  low: "bg-amber-50 text-amber-700",
  insufficient: "bg-zinc-100 text-zinc-500",
};

export default async function RecommendationsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: recommendations }, { data: insights }] = await Promise.all([
    supabase
      .from("recommendations")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .in("status", ["proposed", "accepted"])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("insights")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const editable = canEditContent(ctx.role);
  const statusAction = setRecommendationStatus.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Рекомендации"
        subtitle="Каждая рекомендация содержит действие, обоснование, evidence и уровень уверенности."
      />

      <div className="space-y-4">
        {((recommendations ?? []) as (Recommendation & {
          brands: { name: string } | null;
        })[]).map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${CONFIDENCE_COLORS[r.confidence]}`}>
                {CONFIDENCE_LABELS[r.confidence]}
              </span>
              {r.status === "accepted" && (
                <span className="badge bg-indigo-50 text-indigo-700">Принята</span>
              )}
              <span className="ml-auto text-xs text-zinc-400">
                {r.brands?.name} · {formatDate(r.created_at)}
              </span>
            </div>
            <p className="mt-2 font-medium">{r.action}</p>
            <p className="mt-1 text-sm text-zinc-600">{r.reason}</p>
            {r.test_metric && (
              <p className="mt-2 text-xs text-zinc-400">
                Проверка: {r.test_metric}
                {r.test_period_days && ` · ${r.test_period_days} дней`}
              </p>
            )}
            {editable && r.status === "proposed" && (
              <div className="mt-3 flex gap-2">
                <form action={statusAction}>
                  <input type="hidden" name="recommendation_id" value={r.id} />
                  <input type="hidden" name="status" value="accepted" />
                  <button className="btn-primary">Принять</button>
                </form>
                <form action={statusAction}>
                  <input type="hidden" name="recommendation_id" value={r.id} />
                  <input type="hidden" name="status" value="rejected" />
                  <button className="btn-secondary">Отклонить</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>

      {(!recommendations || recommendations.length === 0) && (
        <EmptyState
          title="Рекомендаций пока нет"
          description="Рекомендации формируются после закрытия аналитического периода (месяц) на основе рассчитанных показателей."
        />
      )}

      {insights && insights.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">Инсайты</h2>
          <div className="space-y-3">
            {(insights as (Insight & { brands: { name: string } | null })[]).map(
              (i) => (
                <div key={i.id} className="card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${CONFIDENCE_COLORS[i.confidence]}`}>
                      {CONFIDENCE_LABELS[i.confidence]}
                    </span>
                    <span className="ml-auto text-xs text-zinc-400">
                      {i.brands?.name} · {formatDate(i.period_start)}–
                      {formatDate(i.period_end)}
                    </span>
                  </div>
                  <p className="mt-2 font-medium">{i.title}</p>
                  <p className="mt-1 text-sm text-zinc-600">{i.body}</p>
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
