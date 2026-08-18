import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateImage, buildBrandStyleDirective } from "@/lib/ai";

/**
 * POST /api/internal/jobs/generate-image — вызывается n8n (WF-CONTENT-002).
 * HMAC-аутентификация тем же контрактом, что и /api/internal/events
 * (x-smm-signature = HMAC-SHA256(raw body, N8N_WEBHOOK_TOKEN)).
 * AI Gateway остаётся единой точкой вызова провайдера — n8n не хранит
 * AI-ключи, только читает результат этого endpoint'а.
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
    brand_id?: string | null;
    content_variant_id?: string | null;
    prompt?: string;
    dimensions?: string;
    requested_by?: string | null;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  if (!body.workspace_id || !body.prompt) {
    return NextResponse.json(
      { error: "workspace_id и prompt обязательны" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Фирменный стиль бренда (цвета/шрифты/референсы из брендбука) — обязательно
  // учитывается при генерации картинок, если задан в профиле бренда.
  let brandStyle: string | null = null;
  if (body.brand_id) {
    const [{ data: profile }, { data: brandRow }] = await Promise.all([
      admin
        .from("brand_profiles")
        .select("brand_colors, fonts, visual_references")
        .eq("brand_id", body.brand_id)
        .maybeSingle(),
      admin.from("brands").select("name").eq("id", body.brand_id).maybeSingle(),
    ]);
    if (profile) {
      brandStyle = buildBrandStyleDirective({
        name: brandRow?.name ?? "",
        brand_colors: profile.brand_colors,
        fonts: profile.fonts,
        visual_references: profile.visual_references,
      });
    }
  }

  const image = await generateImage({
    prompt: body.prompt,
    dimensions: body.dimensions,
    brandStyle,
  });
  const assetId = randomUUID();
  const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const path = `${body.workspace_id}/${body.brand_id || "shared"}/${assetId}/generated.${ext}`;
  const checksum = createHash("sha256").update(image.bytes).digest("hex");

  const { error: uploadError } = await admin.storage
    .from("smm-assets")
    .upload(path, image.bytes, { contentType: image.mimeType });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: insertError } = await admin.from("assets").insert({
    id: assetId,
    workspace_id: body.workspace_id,
    brand_id: body.brand_id || null,
    type: "image",
    storage_bucket: "smm-assets",
    storage_path: path,
    file_name: `generated.${ext}`,
    mime_type: image.mimeType,
    size_bytes: image.bytes.length,
    checksum_sha256: checksum,
    ai_provider: process.env.AI_PROVIDER || "openai",
    generation_prompt: body.prompt,
    created_by: body.requested_by || null,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (body.content_variant_id) {
    await admin.from("content_assets").insert({
      workspace_id: body.workspace_id,
      content_variant_id: body.content_variant_id,
      asset_id: assetId,
      role: "attachment",
    });
  }

  return NextResponse.json({ asset_id: assetId });
}
