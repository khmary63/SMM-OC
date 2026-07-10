"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/workspace";

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
    })
    .eq("brand_id", brandId);
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
