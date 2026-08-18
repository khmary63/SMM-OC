"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, canEditContent, slugify } from "@/lib/workspace";
import { extractKnowledgeText } from "@/lib/knowledge-extract";

export async function createBrand(ws: string, formData: FormData) {
  const supabase = await createClient();
  const workspaceId = String(formData.get("workspace_id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const { data: brand, error } = await supabase
    .from("brands")
    .insert({
      workspace_id: workspaceId,
      name,
      slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 5)}`,
      description: String(formData.get("description") ?? "") || null,
      timezone: String(formData.get("timezone") ?? "Europe/Moscow"),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("brand_profiles").insert({
    workspace_id: workspaceId,
    brand_id: brand.id,
  });

  revalidatePath(`/w/${ws}/brands`);
}

export async function updateBrandProfile(ws: string, formData: FormData) {
  const supabase = await createClient();
  const brandId = String(formData.get("brand_id"));

  const splitList = (v: FormDataEntryValue | null) =>
    String(v ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  const { error: brandError } = await supabase
    .from("brands")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "") || null,
      status: String(formData.get("status") ?? "active"),
    })
    .eq("id", brandId);
  if (brandError) throw new Error(brandError.message);

  const { error } = await supabase
    .from("brand_profiles")
    .update({
      positioning: String(formData.get("positioning") ?? "") || null,
      tone_of_voice: String(formData.get("tone_of_voice") ?? "") || null,
      prompt_rules: String(formData.get("prompt_rules") ?? "") || null,
      prohibited_topics: splitList(formData.get("prohibited_topics")),
      prohibited_phrases: splitList(formData.get("prohibited_phrases")),
      brand_colors: splitList(formData.get("brand_colors")),
      fonts: splitList(formData.get("fonts")),
      visual_references: splitList(formData.get("visual_references")),
    })
    .eq("brand_id", brandId);
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/brands/${brandId}`);
}

/** Добавление ссылки в базу знаний бренда (редакционный календарь / брендбук по URL). */
export async function addKnowledgeLink(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const brandId = String(formData.get("brand_id"));
  const kind = String(formData.get("kind") ?? "other");
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!title || !url) throw new Error("Название и ссылка обязательны");

  const supabase = await createClient();
  const { error } = await supabase.from("brand_knowledge_sources").insert({
    workspace_id: ctx.workspace.id,
    brand_id: brandId,
    kind,
    source_type: "link",
    title,
    url,
    created_by: ctx.userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/brands/${brandId}`);
}

/**
 * Загрузка файла в базу знаний бренда (редакционный календарь / брендбук).
 * Текст извлекается синхронно (pdf/docx/txt/md) — используется генерацией плана.
 */
export async function uploadKnowledgeFile(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const brandId = String(formData.get("brand_id"));
  const kind = String(formData.get("kind") ?? "other");
  const title = String(formData.get("title") ?? "").trim();
  const file = formData.get("file") as File | null;
  if (!title) throw new Error("Название обязательно");
  if (!file || file.size === 0) throw new Error("Файл обязателен");
  if (file.size > 50 * 1024 * 1024) throw new Error("Файл слишком большой (лимит 50 МБ)");

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  const supabase = await createClient();
  const assetId = randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  const path = `${ctx.workspace.id}/${brandId}/knowledge/${assetId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("smm-assets")
    .upload(path, bytes, { contentType: mimeType });
  if (uploadError) throw new Error(uploadError.message);

  const { error: assetError } = await supabase.from("assets").insert({
    id: assetId,
    workspace_id: ctx.workspace.id,
    brand_id: brandId,
    type: mimeType.startsWith("image/") ? "image" : "document",
    storage_bucket: "smm-assets",
    storage_path: path,
    file_name: file.name,
    mime_type: mimeType,
    size_bytes: bytes.length,
    created_by: ctx.userId,
  });
  if (assetError) throw new Error(assetError.message);

  const extracted = await extractKnowledgeText(bytes, mimeType);

  const { error: sourceError } = await supabase.from("brand_knowledge_sources").insert({
    workspace_id: ctx.workspace.id,
    brand_id: brandId,
    kind,
    source_type: "file",
    title,
    asset_id: assetId,
    extracted_text: extracted.text,
    extraction_status: extracted.status,
    created_by: ctx.userId,
  });
  if (sourceError) throw new Error(sourceError.message);

  revalidatePath(`/w/${ws}/brands/${brandId}`);
}

export async function deleteKnowledgeSource(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canEditContent(ctx.role)) throw new Error("Недостаточно прав");

  const brandId = String(formData.get("brand_id"));
  const sourceId = String(formData.get("source_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_knowledge_sources")
    .delete()
    .eq("id", sourceId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/brands/${brandId}`);
}

export async function archiveBrand(ws: string, formData: FormData) {
  const supabase = await createClient();
  const brandId = String(formData.get("brand_id"));
  const { error } = await supabase
    .from("brands")
    .update({ status: "archived" })
    .eq("id", brandId);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/brands`);
}
