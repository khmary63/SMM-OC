import { ApiError, apiHandler, requireApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { canEditContent } from "@/lib/workspace";
import { generateContentCopy } from "@/lib/ai";
import { PLATFORM_LABELS } from "@/lib/types";
import type { ChannelPlatform } from "@/lib/types";

/**
 * Генерация текста (WF-CONTENT-001, синхронный путь).
 * Никогда не переводит материал в approved.
 */
export const POST = apiHandler<{
  workspace_id?: string;
  content_item_id?: string;
}>(async (body) => {
  const ctx = await requireApiContext(body.workspace_id);
  if (!canEditContent(ctx.role)) throw new ApiError("Недостаточно прав", 403);
  if (!body.content_item_id) throw new ApiError("content_item_id обязателен");

  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("*, brands(name)")
    .eq("id", body.content_item_id)
    .eq("workspace_id", ctx.workspaceId)
    .single();
  if (itemError) throw new ApiError("Материал не найден", 404);

  const [{ data: channels }, { data: profile }] = await Promise.all([
    supabase
      .from("channels")
      .select("id, platform")
      .eq("brand_id", item.brand_id)
      .neq("status", "disabled"),
    supabase
      .from("brand_profiles")
      .select("*")
      .eq("brand_id", item.brand_id)
      .maybeSingle(),
  ]);
  if (!channels?.length) throw new ApiError("У бренда нет каналов");

  const variants = await generateContentCopy({
    brand: {
      name: (item.brands as { name: string } | null)?.name ?? "Бренд",
      positioning: profile?.positioning,
      tone_of_voice: profile?.tone_of_voice,
      prohibited_topics: profile?.prohibited_topics ?? [],
      prohibited_phrases: profile?.prohibited_phrases ?? [],
      prompt_rules: profile?.prompt_rules,
    },
    topic: item.topic ?? item.title,
    rubric: item.rubric,
    goal: item.goal,
    format: item.format,
    baseText: item.base_text,
    platforms: channels.map(
      (c) => PLATFORM_LABELS[c.platform as ChannelPlatform] ?? c.platform
    ),
  });

  const created: string[] = [];
  for (let i = 0; i < channels.length && i < variants.length; i++) {
    const v = variants[i];
    const { data: last } = await supabase
      .from("content_variants")
      .select("version_no")
      .eq("content_item_id", item.id)
      .eq("channel_id", channels[i].id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: inserted, error } = await supabase
      .from("content_variants")
      .insert({
        workspace_id: ctx.workspaceId,
        content_item_id: item.id,
        channel_id: channels[i].id,
        version_no: (last?.version_no ?? 0) + 1,
        title: v.title,
        body: v.body,
        hook: v.hook,
        cta: v.cta,
        hashtags: v.hashtags ?? [],
        status: "in_progress",
        generation_metadata: {
          provider: "anthropic",
          model: process.env.AI_MODEL ?? "claude-sonnet-5",
        },
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new ApiError(error.message);
    created.push(inserted.id);
  }

  await supabase
    .from("content_items")
    .update({ ai_generated: true })
    .eq("id", item.id);

  return { content_variant_ids: created };
});
