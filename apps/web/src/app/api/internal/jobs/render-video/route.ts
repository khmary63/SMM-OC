import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SIGNED_URL_TTL_SECONDS = 60 * 30;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * POST /api/internal/jobs/render-video — вызывается n8n (WF-CONTENT-003).
 * Собирает render manifest из assets варианта, вызывает video-worker,
 * опрашивает статус до готовности, загружает MP4+thumbnail в Storage.
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
    content_variant_id?: string;
    asset_ids?: string[];
    render_options?: { duration_per_slide?: number; width?: number; height?: number };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }
  if (!body.workspace_id || !body.content_variant_id || !body.asset_ids?.length) {
    return NextResponse.json(
      { error: "workspace_id, content_variant_id и asset_ids обязательны" },
      { status: 400 }
    );
  }

  const renderUrl = process.env.VIDEO_RENDER_URL;
  const renderToken = process.env.VIDEO_RENDER_TOKEN;
  if (!renderUrl || !renderToken) {
    return NextResponse.json({ error: "VIDEO_RENDER_URL/TOKEN не настроены" }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: sourceAssets, error: assetsError } = await admin
    .from("assets")
    .select("id, storage_bucket, storage_path, brand_id")
    .in("id", body.asset_ids);
  if (assetsError || !sourceAssets?.length) {
    return NextResponse.json({ error: "Исходные assets не найдены" }, { status: 404 });
  }

  const imageUrls: string[] = [];
  for (const asset of sourceAssets) {
    const { data: signed, error: signError } = await admin.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      return NextResponse.json({ error: `Не удалось подписать URL для ${asset.id}` }, { status: 500 });
    }
    imageUrls.push(signed.signedUrl);
  }

  const manifest = {
    image_urls: imageUrls,
    duration_per_slide: body.render_options?.duration_per_slide ?? 3,
    width: body.render_options?.width ?? 1080,
    height: body.render_options?.height ?? 1920,
  };

  const renderRes = await fetch(`${renderUrl}/render`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${renderToken}` },
    body: JSON.stringify(manifest),
    signal: AbortSignal.timeout(15000),
  });
  if (!renderRes.ok) {
    const text = await renderRes.text().catch(() => "");
    return NextResponse.json({ error: `video-worker ${renderRes.status}: ${text.slice(0, 300)}` }, { status: 502 });
  }
  const { job_id: renderJobId } = (await renderRes.json()) as { job_id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = "processing";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${renderUrl}/render/${renderJobId}`, {
      headers: { authorization: `Bearer ${renderToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!statusRes.ok) continue;
    const statusJson = (await statusRes.json()) as { status: string; error?: string };
    status = statusJson.status;
    if (status === "succeeded") break;
    if (status === "failed") {
      return NextResponse.json({ error: `Рендер не удался: ${statusJson.error ?? "unknown"}` }, { status: 502 });
    }
  }
  if (status !== "succeeded") {
    return NextResponse.json({ error: "Таймаут ожидания рендера" }, { status: 504 });
  }

  const brandId = sourceAssets[0]?.brand_id ?? null;

  async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Таймаут: ${label}`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async function fetchAndUpload(filePath: string, fileName: string, mimeType: string) {
    const fileRes = await withDeadline(
      fetch(`${renderUrl}${filePath}`, {
        headers: { authorization: `Bearer ${renderToken}` },
        signal: AbortSignal.timeout(60000),
      }),
      65000,
      `скачивание ${filePath}`
    );
    if (!fileRes.ok) throw new Error(`Не удалось скачать ${filePath}: ${fileRes.status}`);
    const bytes = Buffer.from(await withDeadline(fileRes.arrayBuffer(), 65000, `чтение тела ${filePath}`));
    const assetId = randomUUID();
    const storagePath = `${body.workspace_id}/${brandId || "shared"}/${assetId}/${fileName}`;

    const { error: uploadError } = await admin.storage
      .from("smm-assets")
      .upload(storagePath, bytes, { contentType: mimeType });
    if (uploadError) throw new Error(uploadError.message);

    const checksum = createHash("sha256").update(bytes).digest("hex");
    const { error: insertError } = await admin.from("assets").insert({
      id: assetId,
      workspace_id: body.workspace_id,
      brand_id: brandId,
      type: mimeType.startsWith("video/") ? "video" : "image",
      storage_bucket: "smm-assets",
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: bytes.length,
      checksum_sha256: checksum,
    });
    if (insertError) throw new Error(insertError.message);
    return assetId;
  }

  const videoAssetId = await fetchAndUpload(`/files/${renderJobId}/output.mp4`, "output.mp4", "video/mp4");
  const thumbnailAssetId = await fetchAndUpload(`/files/${renderJobId}/thumbnail.jpg`, "thumbnail.jpg", "image/jpeg");

  await admin.from("content_assets").insert([
    {
      workspace_id: body.workspace_id,
      content_variant_id: body.content_variant_id,
      asset_id: videoAssetId,
      role: "attachment",
    },
    {
      workspace_id: body.workspace_id,
      content_variant_id: body.content_variant_id,
      asset_id: thumbnailAssetId,
      role: "thumbnail",
    },
  ]);

  return NextResponse.json({ video_asset_id: videoAssetId, thumbnail_asset_id: thumbnailAssetId });
}
