import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canEditContent } from "@/lib/workspace";
import { generateNextMonthPlan } from "@/lib/ai";

/**
 * Черновик контент-плана следующего месяца (WF-AN-005).
 * План создаётся в статусе planned и остаётся черновиком до ручного утверждения.
 */
export const POST = apiHandler<{
  workspace_id?: string;
  brand_id?: string;
  month?: string; // YYYY-MM, по умолчанию следующий
  posts_per_week?: number;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.brand_id) throw new ApiError("brand_id обязателен");

  const supabase = await createClient();

  const [{ data: brand }, { data: profile }] = await Promise.all([
    supabase
      .from("brands")
      .select("id, name")
      .eq("id", body.brand_id)
      .eq("workspace_id", ctx.workspaceId)
      .single(),
    supabase
      .from("brand_profiles")
      .select("*")
      .eq("brand_id", body.brand_id)
      .maybeSingle(),
  ]);
  if (!brand) throw new ApiError("Бренд не найден", 404);

  const now = new Date();
  const month =
    body.month ??
    `${now.getUTCFullYear() + (now.getUTCMonth() === 11 ? 1 : 0)}-${String(((now.getUTCMonth() + 1) % 12) + 1).padStart(2, "0")}`;

  // Агрегаты прошлого периода — из аналитической витрины (SQL, не LLM).
  const { data: performance } = await supabase
    .from("v_content_performance")
    .select("rubric, format, engagement_rate, share_rate, reach, views")
    .eq("brand_id", body.brand_id)
    .order("published_at", { ascending: false })
    .limit(100);

  const byRubric = new Map<string, { count: number; er: number }>();
  for (const row of performance ?? []) {
    const key = row.rubric ?? "без рубрики";
    const cur = byRubric.get(key) ?? { count: 0, er: 0 };
    cur.count += 1;
    cur.er += Number(row.engagement_rate ?? 0);
    byRubric.set(key, cur);
  }
  const rubricSummary = [...byRubric.entries()].map(([rubric, v]) => ({
    rubric,
    posts: v.count,
    avg_engagement_rate: v.count ? +(v.er / v.count).toFixed(2) : null,
  }));

  const { data: recommendations } = await supabase
    .from("recommendations")
    .select("action, reason")
    .eq("brand_id", body.brand_id)
    .eq("status", "accepted")
    .limit(10);

  const plan = await generateNextMonthPlan({
    brand: {
      name: brand.name,
      positioning: profile?.positioning,
      tone_of_voice: profile?.tone_of_voice,
      prompt_rules: profile?.prompt_rules,
    },
    month,
    postsPerWeek: body.posts_per_week ?? 3,
    performanceSummary: {
      sample_size: performance?.length ?? 0,
      rubric_performance: rubricSummary,
    },
    acceptedRecommendations: recommendations ?? [],
  });

  const created: string[] = [];
  for (const topic of plan.topics) {
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({
        workspace_id: ctx.workspaceId,
        brand_id: body.brand_id,
        title: topic.title,
        rubric: topic.rubric,
        goal: normalizeGoal(topic.goal),
        format: normalizeFormat(topic.format),
        topic: topic.hypothesis,
        status: "planned",
        planned_at: `${topic.date}T10:00:00Z`,
        ai_generated: true,
        created_by: ctx.userId,
        metadata: { plan_month: month, hypothesis: topic.hypothesis },
      })
      .select("id")
      .single();
    if (!error && item) created.push(item.id);
  }

  return {
    month,
    summary: plan.summary,
    created_items: created.length,
    content_item_ids: created,
  };
});

const GOALS = new Set([
  "reach", "engagement", "growth", "trust", "expertise",
  "traffic", "leads", "sales", "retention", "awareness",
]);
const FORMATS = new Set([
  "text", "image", "gallery", "carousel", "video", "short_video",
  "story", "link", "poll", "document", "mixed",
]);

function normalizeGoal(goal: string | undefined): string | null {
  const g = goal?.toLowerCase().trim() ?? "";
  return GOALS.has(g) ? g : null;
}

function normalizeFormat(format: string | undefined): string {
  const f = format?.toLowerCase().trim() ?? "";
  return FORMATS.has(f) ? f : "text";
}
