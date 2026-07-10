import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { PLATFORM_LABELS } from "@/lib/types";
import type { ChannelPlatform } from "@/lib/types";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: growth }, { data: performance }] = await Promise.all([
    supabase
      .from("v_channel_daily_growth")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .order("local_date", { ascending: false })
      .limit(60),
    supabase
      .from("v_content_performance")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .order("published_at", { ascending: false })
      .limit(50),
  ]);

  // Последний срез по каждому каналу
  const latestByChannel = new Map<string, NonNullable<typeof growth>[number]>();
  for (const row of growth ?? []) {
    if (!latestByChannel.has(row.channel_id)) {
      latestByChannel.set(row.channel_id, row);
    }
  }

  return (
    <div>
      <PageHeader
        title="Аналитика"
        subtitle="Снимки метрик по каналам и производительность контента. Недоступные метрики отображаются как «—», не как 0."
      />

      <h2 className="mb-3 text-lg font-semibold">Каналы</h2>
      {latestByChannel.size > 0 ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5">Платформа</th>
                <th className="px-4 py-2.5">Дата среза</th>
                <th className="px-4 py-2.5 text-right">Подписчики</th>
                <th className="px-4 py-2.5 text-right">Δ за день</th>
                <th className="px-4 py-2.5 text-right">Рост, %</th>
                <th className="px-4 py-2.5 text-right">Охват</th>
                <th className="px-4 py-2.5 text-right">Просмотры</th>
                <th className="px-4 py-2.5 text-right">Реакции</th>
              </tr>
            </thead>
            <tbody>
              {[...latestByChannel.values()].map((row) => (
                <tr key={row.channel_id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-2.5">
                    {PLATFORM_LABELS[row.platform as ChannelPlatform] ?? row.platform}
                  </td>
                  <td className="px-4 py-2.5">{formatDate(row.local_date)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.followers)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {row.follower_delta === null
                      ? "—"
                      : `${row.follower_delta > 0 ? "+" : ""}${formatNumber(row.follower_delta)}`}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatPercent(row.follower_growth_pct)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.reach)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.views)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.reactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Снимков метрик пока нет"
          description="Метрики собираются автоматически после подключения каналов и настройки n8n, либо запустите ручную синхронизацию на странице каналов."
        />
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold">Контент</h2>
      {performance && performance.length > 0 ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5">Материал</th>
                <th className="px-4 py-2.5">Рубрика</th>
                <th className="px-4 py-2.5">Дата</th>
                <th className="px-4 py-2.5 text-right">Охват</th>
                <th className="px-4 py-2.5 text-right">Просмотры</th>
                <th className="px-4 py-2.5 text-right">ER</th>
                <th className="px-4 py-2.5 text-right">Share rate</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((row) => (
                <tr key={`${row.publication_id}-${row.scope ?? "x"}`} className="border-b border-zinc-100 last:border-0">
                  <td className="max-w-64 truncate px-4 py-2.5">{row.title}</td>
                  <td className="px-4 py-2.5">{row.rubric ?? "—"}</td>
                  <td className="px-4 py-2.5">{formatDate(row.published_at)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.reach)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(row.views)}</td>
                  <td className="px-4 py-2.5 text-right">{formatPercent(row.engagement_rate)}</td>
                  <td className="px-4 py-2.5 text-right">{formatPercent(row.share_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Опубликованного контента с метриками пока нет"
          description="Данные появятся после первых публикаций и сбора снимков метрик (1h, 6h, 24h, 72h, 7d, 30d)."
        />
      )}
    </div>
  );
}
