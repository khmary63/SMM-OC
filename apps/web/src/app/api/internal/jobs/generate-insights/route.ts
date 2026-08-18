import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsights } from "@/lib/ai";

/**
 * POST /api/internal/jobs/generate-insights — вызывается n8n (WF-AN-003/004).
 * Строит evidence JSON из SQL-витрин (§12 архитектуры: LLM получает уже
 * агрегированные данные, не сырые метрики), вызывает generateInsights() и
 * записывает summary как insights + каждую рекомендацию как отдельную
 * запись в recommendations, привязанную к этому insight.
 */
export async function POST(request: Request) {
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Не настроен" }, { status: 503 });
  }

  const rawBody = await request.text();
  const provided = request.headers.get("x-smm-signature") ?? "";
  const expected = createHmac("sha256", token).update(rawBody).digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Неверная подпись" }, { status: 401 });
  }

  let body: {
    workspace_id?: string;
    brand_id?: string;
    period_start?: string; // YYYY-MM-DD
    period_end?: string; // YYYY-MM-DD
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  if (!body.workspace_id || !body.brand_id || !body.period_start || !body.period_end) {
    return NextResponse.json(
      { error: "workspace_id, brand_id, period_start и period_end обязательны" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: performance, error: perfError } = await admin
    .from("v_content_performance")
    .select("*")
    .eq("workspace_id", body.workspace_id)
    .eq("brand_id", body.brand_id)
    .gte("published_at", body.period_start)
    .lte("published_at", body.period_end);
  if (perfError) {
    return NextResponse.json({ error: perfError.message }, { status: 500 });
  }

  const rows = performance ?? [];
  const sampleSize = rows.length;

  function avg(nums: (number | null)[]): number | null {
    const vals = nums.filter((n): n is number => n !== null && n !== undefined);
    if (!vals.length) return null;
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  }

  function groupBy(key: "rubric" | "format") {
    const map = new Map<string, { engagement_rate: (number | null)[]; share_rate: (number | null)[]; count: number }>();
    for (const row of rows) {
      const k = (row[key] as string | null) ?? "не указано";
      const cur = map.get(k) ?? { engagement_rate: [], share_rate: [], count: 0 };
      cur.engagement_rate.push(row.engagement_rate as number | null);
      cur.share_rate.push(row.share_rate as number | null);
      cur.count += 1;
      map.set(k, cur);
    }
    return [...map.entries()].map(([name, v]) => ({
      [key]: name,
      posts: v.count,
      avg_engagement_rate: avg(v.engagement_rate),
      avg_share_rate: avg(v.share_rate),
    }));
  }

  const sorted = [...rows].sort(
    (a, b) => ((b.engagement_rate as number) ?? -1) - ((a.engagement_rate as number) ?? -1)
  );
  const topPosts = sorted.slice(0, 5).map((r) => ({
    title: r.title,
    rubric: r.rubric,
    format: r.format,
    engagement_rate: r.engagement_rate,
    reach: r.reach,
    views: r.views,
  }));
  const weakPosts = sorted
    .slice(-5)
    .reverse()
    .map((r) => ({
      title: r.title,
      rubric: r.rubric,
      format: r.format,
      engagement_rate: r.engagement_rate,
      reach: r.reach,
      views: r.views,
    }));

  const { data: channels } = await admin
    .from("channels")
    .select("id, platform")
    .eq("brand_id", body.brand_id);

  const channelBaselines: Record<string, unknown> = {};
  for (const ch of channels ?? []) {
    const chRows = rows.filter((r) => r.channel_id === ch.id);
    channelBaselines[ch.platform] = {
      posts: chRows.length,
      avg_engagement_rate: avg(chRows.map((r) => r.engagement_rate as number | null)),
      avg_share_rate: avg(chRows.map((r) => r.share_rate as number | null)),
    };
  }

  const statisticalLimits: string[] = [];
  if (sampleSize < 10) statisticalLimits.push("sample_size < 10: confidence не выше low");
  if (sampleSize < 3) statisticalLimits.push("sample_size < 3: confidence insufficient");

  const evidence = {
    period: `${body.period_start} — ${body.period_end}`,
    sample_size: sampleSize,
    channel_baselines: channelBaselines,
    rubric_performance: groupBy("rubric"),
    format_performance: groupBy("format"),
    top_posts: topPosts,
    weak_posts: sampleSize > 5 ? weakPosts : [],
    anomalies: [],
    statistical_limits: statisticalLimits,
  };

  const result = await generateInsights(evidence);

  const { data: brand } = await admin.from("brands").select("id").eq("id", body.brand_id).single();
  if (!brand) {
    return NextResponse.json({ error: "Бренд не найден" }, { status: 404 });
  }

  const confidenceRank = { insufficient: 0, low: 1, medium: 2, high: 3 } as const;
  const overallConfidence =
    result.recommendations.length > 0
      ? result.recommendations.reduce(
          (max, r) => (confidenceRank[r.confidence] > confidenceRank[max] ? r.confidence : max),
          "insufficient" as keyof typeof confidenceRank
        )
      : sampleSize < 3
        ? "insufficient"
        : sampleSize < 10
          ? "low"
          : "medium";

  const { data: insight, error: insightError } = await admin
    .from("insights")
    .insert({
      workspace_id: body.workspace_id,
      brand_id: body.brand_id,
      period_start: body.period_start,
      period_end: body.period_end,
      insight_type: "period_summary",
      title: `Итоги периода ${body.period_start} — ${body.period_end}`,
      body: result.summary,
      evidence: [evidence],
      confidence: overallConfidence,
      model_name: process.env.AI_MODEL ?? "claude-sonnet-5",
    })
    .select("id")
    .single();
  if (insightError) {
    return NextResponse.json({ error: insightError.message }, { status: 500 });
  }

  const recommendationIds: string[] = [];
  for (const rec of result.recommendations) {
    const { data: inserted, error: recError } = await admin
      .from("recommendations")
      .insert({
        workspace_id: body.workspace_id,
        brand_id: body.brand_id,
        insight_id: insight.id,
        action: rec.action,
        reason: rec.reason,
        evidence: rec.evidence ?? [],
        confidence: rec.confidence,
        test_metric: rec.test_metric,
        test_period_days: rec.test_period_days ?? 30,
      })
      .select("id")
      .single();
    if (!recError && inserted) recommendationIds.push(inserted.id);
  }

  return NextResponse.json({ insight_id: insight.id, recommendation_ids: recommendationIds });
}
