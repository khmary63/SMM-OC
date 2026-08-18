"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, canEditContent, canApprove } from "@/lib/workspace";
import { generateContentCopy } from "@/lib/ai";
import { emitWorkspaceEvent } from "@/lib/webhooks";
import { PLATFORM_LABELS } from "@/lib/types";
import type { ChannelPlatform } from "@/lib/types";

export async function createContentItem(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const plannedAt = String(formData.get("planned_at") ?? "");

  const { data, error } = await supabase
    .from("content_items")
    .insert({
      workspace_id: ctx.workspace.id,
      brand_id: String(formData.get("brand_id")),
      title: String(formData.get("title") ?? "").trim(),
      topic: String(formData.get("topic") ?? "") || null,
      rubric: String(formData.get("rubric") ?? "") || null,
      goal: String(formData.get("goal") ?? "") || null,
      format: String(formData.get("format") ?? "text"),
      base_text: String(formData.get("base_text") ?? "") || null,
      status: plannedAt ? "planned" : "idea",
      planned_at: plannedAt ? new Date(plannedAt).toISOString() : null,
      created_by: ctx.userId,
      owner_user_id: ctx.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  redirect(`/w/${ws}/content/${data.id}`);
}

export async function updateContentItem(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const id = String(formData.get("content_item_id"));
  const plannedAt = String(formData.get("planned_at") ?? "");

  const { error } = await supabase
    .from("content_items")
    .update({
      title: String(formData.get("title") ?? "").trim(),
      topic: String(formData.get("topic") ?? "") || null,
      rubric: String(formData.get("rubric") ?? "") || null,
      goal: String(formData.get("goal") ?? "") || null,
      format: String(formData.get("format") ?? "text"),
      base_text: String(formData.get("base_text") ?? "") || null,
      planned_at: plannedAt ? new Date(plannedAt).toISOString() : null,
    })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/content/${id}`);
}

export async function saveVariant(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const variantId = String(formData.get("variant_id") ?? "");
  const contentItemId = String(formData.get("content_item_id"));
  const channelId = String(formData.get("channel_id") ?? "") || null;

  const fields = {
    title: String(formData.get("title") ?? "") || null,
    body: String(formData.get("body") ?? "") || null,
    hook: String(formData.get("hook") ?? "") || null,
    cta: String(formData.get("cta") ?? "") || null,
    hashtags: String(formData.get("hashtags") ?? "")
      .split(/[\s,]+/)
      .map((h) => h.trim().replace(/^#/, ""))
      .filter(Boolean),
  };

  if (variantId) {
    // Правка существующего варианта: если он был согласован — новая версия.
    const { data: current, error: curError } = await supabase
      .from("content_variants")
      .select("*")
      .eq("id", variantId)
      .single();
    if (curError) throw new Error(curError.message);

    if (["approved", "awaiting_approval"].includes(current.status)) {
      const { error } = await supabase.from("content_variants").insert({
        workspace_id: ctx.workspace.id,
        content_item_id: contentItemId,
        channel_id: current.channel_id,
        version_no: current.version_no + 1,
        ...fields,
        status: "in_progress",
        created_by: ctx.userId,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("content_variants")
        .update(fields)
        .eq("id", variantId);
      if (error) throw new Error(error.message);
    }
  } else {
    let lastQuery = supabase
      .from("content_variants")
      .select("version_no")
      .eq("content_item_id", contentItemId);
    lastQuery =
      channelId === null
        ? lastQuery.is("channel_id", null)
        : lastQuery.eq("channel_id", channelId);
    const { data: last } = await lastQuery
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("content_variants").insert({
      workspace_id: ctx.workspace.id,
      content_item_id: contentItemId,
      channel_id: channelId,
      version_no: (last?.version_no ?? 0) + 1,
      ...fields,
      status: "in_progress",
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/w/${ws}/content/${contentItemId}`);
}

/** Прикрепление файлов из Медиатеки к карточке контента целиком. */
export async function attachContentItemAssets(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const contentItemId = String(formData.get("content_item_id"));
  const assetIds = [...new Set(formData.getAll("asset_ids").map(String))].filter(
    Boolean
  );
  if (assetIds.length === 0) return;

  const { data: last } = await supabase
    .from("content_item_assets")
    .select("sort_order")
    .eq("content_item_id", contentItemId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = (last?.sort_order ?? -1) + 1;

  const rows = assetIds.map((assetId) => ({
    workspace_id: ctx.workspace.id,
    content_item_id: contentItemId,
    asset_id: assetId,
    sort_order: nextOrder++,
    created_by: ctx.userId,
  }));

  const { error } = await supabase
    .from("content_item_assets")
    .upsert(rows, { onConflict: "content_item_id,asset_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/content/${contentItemId}`);
}

/** Открепление одного файла от карточки контента. */
export async function removeContentItemAsset(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const contentItemId = String(formData.get("content_item_id"));
  const assetId = String(formData.get("asset_id"));

  const { error } = await supabase
    .from("content_item_assets")
    .delete()
    .eq("content_item_id", contentItemId)
    .eq("asset_id", assetId);
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/content/${contentItemId}`);
}

/** AI-генерация адаптаций (аналог WF-CONTENT-001, синхронный путь). */
export async function generateVariants(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const contentItemId = String(formData.get("content_item_id"));

  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("*, brands(name), brand_profiles:brands(brand_profiles(*))")
    .eq("id", contentItemId)
    .single();
  if (itemError) throw new Error(itemError.message);

  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, name")
    .eq("brand_id", item.brand_id)
    .in("status", ["active", "disconnected"]);

  if (!channels || channels.length === 0) {
    throw new Error("У бренда нет каналов — подключите хотя бы один");
  }

  const { data: profile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("brand_id", item.brand_id)
    .maybeSingle();

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

  // Раскладываем результат по каналам в порядке генерации.
  for (let i = 0; i < channels.length && i < variants.length; i++) {
    const v = variants[i];
    const channel = channels[i];

    const { data: last } = await supabase
      .from("content_variants")
      .select("version_no")
      .eq("content_item_id", contentItemId)
      .eq("channel_id", channel.id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("content_variants").insert({
      workspace_id: ctx.workspace.id,
      content_item_id: contentItemId,
      channel_id: channel.id,
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
        generated_at: new Date().toISOString(),
      },
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  }

  await supabase
    .from("content_items")
    .update({ ai_generated: true, status: "in_progress" })
    .eq("id", contentItemId)
    .in("status", ["idea", "planned"]);

  revalidatePath(`/w/${ws}/content/${contentItemId}`);
}

/** Запрос согласования конкретной версии (WF-APPROVAL-001). */
export async function requestApproval(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const variantId = String(formData.get("variant_id"));

  const { data: variant, error: vError } = await supabase
    .from("content_variants")
    .select("id, content_item_id, version_no, workspace_id")
    .eq("id", variantId)
    .single();
  if (vError) throw new Error(vError.message);

  // Отменяем устаревшие pending approvals этого варианта.
  await supabase
    .from("approvals")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("content_variant_id", variantId)
    .eq("status", "pending");

  const { error } = await supabase.from("approvals").insert({
    workspace_id: ctx.workspace.id,
    content_variant_id: variantId,
    requested_by: ctx.userId,
    version_no: variant.version_no,
    status: "pending",
  });
  if (error) throw new Error(error.message);

  await supabase
    .from("content_variants")
    .update({ status: "awaiting_approval" })
    .eq("id", variantId);
  await supabase
    .from("content_items")
    .update({ status: "awaiting_approval" })
    .eq("id", variant.content_item_id);

  revalidatePath(`/w/${ws}/content/${variant.content_item_id}`);
  revalidatePath(`/w/${ws}/approvals`);
}

/** Решение по согласованию (WF-APPROVAL-002). */
export async function decideApproval(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canApprove(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const approvalId = String(formData.get("approval_id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const comment = String(formData.get("comment") ?? "") || null;

  const { data: approval, error: aError } = await supabase
    .from("approvals")
    .select("*, content_variants(id, content_item_id, version_no)")
    .eq("id", approvalId)
    .eq("status", "pending")
    .single();
  if (aError) throw new Error("Согласование не найдено или уже решено");

  const variant = approval.content_variants as {
    id: string;
    content_item_id: string;
    version_no: number;
  };

  // Нельзя согласовать устаревшую версию, если появилась более новая.
  const { data: newer } = await supabase
    .from("content_variants")
    .select("id")
    .eq("content_item_id", variant.content_item_id)
    .gt("version_no", variant.version_no)
    .limit(1);
  if (decision === "approved" && newer && newer.length > 0) {
    throw new Error("Появилась более новая версия — согласуйте её");
  }

  const { error } = await supabase
    .from("approvals")
    .update({
      status: decision === "approved" ? "approved" : "rejected",
      approver_user_id: ctx.userId,
      comment,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approvalId);
  if (error) throw new Error(error.message);

  if (decision === "approved") {
    await supabase
      .from("content_variants")
      .update({ status: "approved" })
      .eq("id", variant.id);
    await supabase
      .from("content_items")
      .update({
        status: "approved",
        approved_version_no: variant.version_no,
      })
      .eq("id", variant.content_item_id);
  } else {
    await supabase
      .from("content_variants")
      .update({ status: "revision_requested" })
      .eq("id", variant.id);
    await supabase
      .from("content_items")
      .update({ status: "revision_requested" })
      .eq("id", variant.content_item_id);
  }

  await emitWorkspaceEvent(
    ctx.workspace.id,
    decision === "approved" ? "content.approved" : "content.revision_requested",
    {
      content_item_id: variant.content_item_id,
      content_variant_id: variant.id,
      version_no: variant.version_no,
      comment,
    }
  );

  revalidatePath(`/w/${ws}/approvals`);
  revalidatePath(`/w/${ws}/content/${variant.content_item_id}`);
}
