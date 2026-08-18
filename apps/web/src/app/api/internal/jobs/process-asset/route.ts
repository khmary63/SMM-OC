import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/internal/jobs/process-asset — вызывается n8n (WF-ASSET-001).
 * Считает checksum/размеры исходника и создаёт производные (thumbnail).
 * Не хранит временные бинарные файлы дольше одного запроса (§ WF-ASSET-001).
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

  let body: { asset_id?: string; required_variants?: string[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }
  if (!body.asset_id) {
    return NextResponse.json({ error: "asset_id обязателен" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: asset, error: assetError } = await admin
    .from("assets")
    .select("*")
    .eq("id", body.asset_id)
    .single();
  if (assetError || !asset) {
    return NextResponse.json({ error: "Asset не найден" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await admin.storage
    .from(asset.storage_bucket)
    .download(asset.storage_path);
  if (downloadError || !file) {
    return NextResponse.json(
      { error: downloadError?.message ?? "Не удалось скачать исходник" },
      { status: 500 }
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const derivedAssetIds: string[] = [];

  if (asset.type === "image") {
    const img = sharp(bytes);
    const meta = await img.metadata();

    await admin
      .from("assets")
      .update({
        checksum_sha256: asset.checksum_sha256 ?? checksum,
        width: asset.width ?? meta.width ?? null,
        height: asset.height ?? meta.height ?? null,
      })
      .eq("id", asset.id);

    const variants = body.required_variants?.length
      ? body.required_variants
      : ["thumbnail"];

    for (const variant of variants) {
      if (variant !== "thumbnail") continue;
      const thumbWidth = 480;
      const thumbBuf = await sharp(bytes)
        .resize({ width: thumbWidth, withoutEnlargement: true })
        .toFormat("jpeg", { quality: 82 })
        .toBuffer();
      const thumbId = randomUUID();
      const thumbPath = `${asset.workspace_id}/${asset.brand_id || "shared"}/${thumbId}/thumbnail.jpg`;

      const { error: upErr } = await admin.storage
        .from(asset.storage_bucket)
        .upload(thumbPath, thumbBuf, { contentType: "image/jpeg" });
      if (upErr) continue;

      const thumbMeta = await sharp(thumbBuf).metadata();
      const { error: insErr } = await admin.from("assets").insert({
        id: thumbId,
        workspace_id: asset.workspace_id,
        brand_id: asset.brand_id,
        type: "image",
        storage_bucket: asset.storage_bucket,
        storage_path: thumbPath,
        file_name: "thumbnail.jpg",
        mime_type: "image/jpeg",
        size_bytes: thumbBuf.length,
        width: thumbMeta.width ?? null,
        height: thumbMeta.height ?? null,
        checksum_sha256: createHash("sha256").update(thumbBuf).digest("hex"),
        source_asset_id: asset.id,
        metadata: { derived: "thumbnail" },
      });
      if (!insErr) derivedAssetIds.push(thumbId);
    }
  } else {
    // Видео/аудио/документы: MVP считает только checksum исходника,
    // рендер thumbnail для видео уже выполняется video-worker'ом (WF-CONTENT-003).
    await admin
      .from("assets")
      .update({ checksum_sha256: asset.checksum_sha256 ?? checksum })
      .eq("id", asset.id);
  }

  return NextResponse.json({ derived_asset_ids: derivedAssetIds });
}
